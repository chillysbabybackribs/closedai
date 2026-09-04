import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  ChatAccount, ChatAttachment, ChatConnection, ChatEvent, ChatHistoryWindow, ChatPlanUsage,
  ChatSnapshot, ChatThreadContent, ChatThreadSummary, ChatTurnContextReport
} from '../../shared/chat.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import { shrinkPastedImages } from '../chat-attachment-images.js'
import { buildThreadHandoff, handoffAdditionalContext, type ThreadHandoffSource } from '../chat-context/thread-handoff.js'
import { buildTurnAdditionalContext, type ActiveBrowserContext } from '../chat-context/turn-context.js'
import { buildTurnContextReport } from '../chat-context/turn-inspector.js'
import { ChatModelState } from '../chat-model-state.js'
import { messageOf } from '../chat-normalizers.js'
import { ChatTranscript } from '../chat-transcript.js'
import type { ScreenshotStore } from '../tools/capture/screenshot-store.js'
import type { AcpSessionSetup } from './cursor-acp.js'
import { CursorArchive } from './cursor-archive.js'
import type { CursorToolBridge } from './cursor-mcp.js'
import { isCursorAuthFailure, parseCursorAccountEmail, parseCursorPlan, runCursorCommand } from './cursor-cli.js'
import { cursorSessionIdOf, cursorThreadId } from './cursor-ids.js'
import { buildCursorPrompt } from './cursor-input.js'
import { cursorAcpModelId, cursorModelCatalog } from './cursor-models.js'
import { CursorSession } from './cursor-session.js'
import type { TranscriptOp, TurnEnd } from './cursor-stream.js'

// The Cursor provider, mirroring ChatService's surface so the hub can route to any of the four.
// Everything model-facing is the `cursor-agent acp` server on the user's Cursor subscription:
// one long-lived JSON-RPC process per pane, the catalog that `session/new` reports, and the
// session store the agent itself keeps — `session/list` is the chat history and `session/load`
// replays a transcript, so unlike the Antigravity lane this provider records nothing of its own.

const SIGN_IN_MESSAGE = 'Sign in to Cursor: run `cursor-agent login` in a terminal, complete the browser login, then choose a Cursor model again.'

export class CursorChatService extends EventEmitter {
  private session: CursorSession | null = null
  private connection: ChatConnection = { state: 'starting', message: 'Starting Cursor…' }
  private account: ChatAccount | null = null
  private readonly modelState = new ChatModelState()
  private readonly archive: CursorArchive
  private threadName: string | null = null
  private activeTurnId: string | null = null
  private turnContext: ChatTurnContextReport | null = null
  private planUsage: ChatPlanUsage | null = null
  private readonly transcript: ChatTranscript
  private startPromise: Promise<void> | null = null
  private supportsImages = true
  /**
   * This pane's key in the tool bridge URLs. One per pane rather than per session: the key names
   * the caller, and a pane has one thread at a time, so it survives every new chat and reload.
   */
  private readonly bridgeKey = randomUUID()

  constructor(
    readonly cwd: string,
    private readonly settings: AppSettingsAccess,
    private readonly bridge: CursorToolBridge,
    stateDir: string,
    private readonly activeBrowserContext: () => ActiveBrowserContext | null = () => null,
    screenshots: Pick<ScreenshotStore, 'get'> | null = null,
    private readonly paneId: string | null = null
  ) {
    super()
    this.archive = new CursorArchive(stateDir)
    this.transcript = new ChatTranscript(
      cwd,
      () => this.activeTurnId,
      (event) => this.emitEvent(event),
      (callId) => screenshots?.get(callId) ?? null
    )
  }

  snapshot(window?: ChatHistoryWindow): ChatSnapshot {
    const page = window ? this.transcript.page(window) : null
    return {
      provider: 'cursor',
      connection: { ...this.connection },
      account: this.account ? { ...this.account } : null,
      models: this.modelState.models.map((model) => ({ ...model })),
      selectedModel: this.modelState.selectedModel,
      selectedReasoningEffort: this.modelState.selectedReasoningEffort,
      cwd: this.cwd,
      threadId: this.session?.sessionId ? cursorThreadId(this.session.sessionId) : null,
      threadName: this.threadName,
      activeTurnId: this.activeTurnId,
      contextUsage: null,
      planUsage: this.planUsage,
      turnContext: this.turnContext,
      items: page?.items ?? this.transcript.snapshot(),
      ...(page ? { history: { hasEarlier: page.hasEarlier, backgroundTasks: page.backgroundTasks } } : {})
    }
  }

  /** Open the ACP server (which also proves sign-in), read the catalog, and reopen the saved session. */
  start(options: { warm?: boolean } = {}): Promise<void> {
    this.startPromise ??= this.connect(options.warm === true).finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async send(text: string, attachments: ChatAttachment[] = []): Promise<void> {
    try {
      await this.ensureReady()
      const session = this.session!
      if (this.activeTurnId) throw new Error('A Cursor turn is already running')
      const pendingHandoff = this.settings.get().chatContinuation?.handoff ?? null
      const context = {
        ...this.turnAdditionalContext(text),
        ...(pendingHandoff ? handoffAdditionalContext(pendingHandoff) : {})
      }
      const turn = await buildCursorPrompt(
        text,
        shrinkPastedImages(attachments),
        Object.keys(context).length ? context : undefined,
        { images: this.supportsImages }
      )
      if (!turn) return
      await this.bridge.start()
      this.transcript.addOptimisticUser(randomUUID(), turn.prompt, turn.summaries)
      await session.send(turn.blocks)
      this.setTurnContext(buildTurnContextReport({
        provider: 'cursor',
        model: this.modelState.selectedModel,
        threadId: session.sessionId ? cursorThreadId(session.sessionId) : null,
        prompt: turn.prompt,
        attachments: turn.summaries,
        additionalContext: Object.keys(context).length ? context : undefined
      }))
      await this.clearDeliveredHandoff()
    } catch (error) {
      this.addNotice(messageOf(error), 'error')
      throw error
    }
  }

  /**
   * ACP reports no quota, and the CLI has no usage verb — `about` names only the tier. So the
   * hover card shows the plan with an explicit "no windows" rather than an invented number.
   */
  async refreshPlanUsage(): Promise<void> {
    if (this.connection.state !== 'ready' || this.planUsage) return
    const about = await runCursorCommand(['about'])
    this.setPlanUsage({
      plan: about.ok ? parseCursorPlan(about.stdout) : null,
      windows: [],
      note: null,
      unavailable: 'The Cursor CLI does not report subscription usage.',
      updatedAt: Date.now()
    })
  }

  async interrupt(): Promise<void> {
    try {
      await this.session?.interrupt()
    } catch (error) {
      this.addNotice(`Could not stop the turn: ${messageOf(error)}`, 'error')
      throw error
    }
  }

  async selectModel(modelId: string): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before changing models')
    const preference = this.modelState.preferenceForModel(modelId)
    await this.settings.set({ chatModelId: modelId, chatReasoningEffort: preference.effort })
    this.modelState.apply(preference)
    const acpModelId = cursorAcpModelId(modelId)
    // ACP changes the model on the live session, so an open chat keeps its history.
    if (acpModelId) {
      await this.session?.selectModel(acpModelId).catch((error: unknown) => {
        this.addNotice(`Cursor did not accept that model: ${messageOf(error)}`, 'error')
      })
    }
    this.emitEvent({ type: 'model', selectedModel: modelId, selectedReasoningEffort: preference.effort })
  }

  /**
   * Cursor bakes the effort into the model id the agent accepts — `session/set_model` rejects
   * every bracket override — so the catalog offers no effort options and this cannot be reached
   * from the picker. It stays to satisfy the provider contract.
   */
  async selectReasoningEffort(effort: string): Promise<void> {
    if (this.modelState.selectedReasoningEffort === effort) return
    throw new Error('Cursor models carry their reasoning effort; pick a different model instead.')
  }

  /** The sessions the agent holds for this workspace, minus the ones archived here. */
  async listThreads(): Promise<ChatThreadSummary[]> {
    if (this.connection.state !== 'ready') return []
    const [sessions, archived] = await Promise.all([this.session?.list() ?? [], this.archive.ids()])
    return sessions
      .filter((entry) => !archived.has(entry.sessionId))
      .map((entry): ChatThreadSummary => ({
        id: cursorThreadId(entry.sessionId),
        title: entry.title,
        preview: '',
        createdAt: entry.updatedAt,
        updatedAt: entry.updatedAt
      }))
  }

  async readThread(threadId: string): Promise<ChatThreadContent> {
    const sessionId = cursorSessionIdOf(threadId)
    if (!sessionId) throw new Error('Invalid Cursor thread')
    await this.ensureConnected()
    const items = await this.session!.replay(sessionId)
    if (!items.length) throw new Error('Cursor did not replay any messages for that chat')
    return { threadId, threadName: null, items }
  }

  /** Clear the pane; the next message starts a fresh session. */
  async newThread(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before starting a new chat')
    if (!this.session?.sessionId && this.transcript.isEmpty && !this.settings.get().chatContinuation) return
    await this.detachThread()
    await this.settings.set({ chatContinuation: null })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  async continueInNewThread(from?: ThreadHandoffSource): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before continuing in a new chat')
    const source = from ?? this.ownHandoff()
    if (!source) throw new Error('There is no conversation to continue yet')
    await this.detachThread()
    await this.settings.set({
      chatContinuation: {
        sourcePaneId: this.paneId,
        sourceThreadId: source.threadId,
        sourceProvider: source.provider,
        sourceTitle: source.title,
        handoff: source.text,
        createdAt: Date.now()
      }
    })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
    this.addNotice(`Continuing from “${source.title}”. A short summary of that chat goes with your next message.`, 'info', null)
  }

  async openThread(threadId: string): Promise<void> {
    const sessionId = cursorSessionIdOf(threadId)
    if (!sessionId) throw new Error('Invalid thread')
    if (this.activeTurnId) throw new Error('Stop the current turn before switching chats')
    await this.ensureConnected()
    if (sessionId === this.session!.sessionId) return
    try {
      await this.resumeSession(sessionId)
    } catch (error) {
      this.addNotice(`Could not open that chat: ${messageOf(error)}`, 'error')
      throw error
    }
  }

  async archiveThread(threadId: string): Promise<void> {
    const sessionId = cursorSessionIdOf(threadId)
    if (!sessionId) throw new Error('Invalid thread')
    if (sessionId === this.session?.sessionId && this.activeTurnId) {
      throw new Error('Stop the current turn before archiving this chat')
    }
    await this.archive.add(sessionId)
    if (sessionId === this.session?.sessionId) await this.newThread()
  }

  stop(): void {
    this.bridge.unbind(this.bridgeKey)
    void this.session?.retire()
  }

  private async connect(warm: boolean): Promise<void> {
    this.setConnection({ state: 'starting', message: 'Starting Cursor…' })
    try {
      this.session ??= this.createSession()
      const setup = await this.session.warm()
      if (setup.models.length === 0) throw new Error('Cursor reported no available models')
      await this.readAccount()
      this.setConnection({ state: 'ready', message: 'Cursor is ready' })
      if (!warm) await this.session.retire()
      else await this.resumePersistedSession()
      void this.refreshPlanUsage()
    } catch (error) {
      const message = messageOf(error)
      this.setConnection(isCursorAuthFailure(message)
        ? { state: 'signed-out', message: SIGN_IN_MESSAGE }
        : { state: 'unavailable', message: `Cursor is unavailable: ${message}` })
    }
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  /** `about` is the only place the signed-in email appears; a failure leaves the account unnamed. */
  private async readAccount(): Promise<void> {
    const about = await runCursorCommand(['about'])
    const email = about.ok ? parseCursorAccountEmail(about.stdout) : null
    this.account = { type: 'other', email, planType: about.ok ? parseCursorPlan(about.stdout) : null }
  }

  private createSession(): CursorSession {
    return new CursorSession({
      cwd: this.cwd,
      mcpServers: () => this.bridge.servers(this.bridgeKey),
      modelId: () => cursorAcpModelId(this.modelState.selectedModel),
      apply: (op) => this.applyOp(op),
      onTurn: (turnId) => this.setTurn(turnId),
      onSessionId: (sessionId) => this.adoptSessionId(sessionId),
      onSetup: (setup) => this.adoptSetup(setup),
      onTitle: (title) => this.adoptTitle(title),
      onTurnEnd: (turnId, end) => this.onTurnEnd(turnId, end),
      traceScope: () => ({ paneId: this.paneId, provider: 'cursor', turnId: this.activeTurnId })
    })
  }

  /** Every session open re-reports the catalog, which is where the model list comes from. */
  private adoptSetup(setup: AcpSessionSetup): void {
    if (setup.models.length === 0) return
    const saved = this.settings.get()
    const previous = this.modelState.selectedModel
    this.modelState.load(cursorModelCatalog(setup.models, setup.currentModelId, saved.chatModelId, saved.chatReasoningEffort))
    if (this.modelState.selectedModel !== previous) {
      this.emitEvent({
        type: 'model',
        selectedModel: this.modelState.selectedModel ?? '',
        selectedReasoningEffort: this.modelState.selectedReasoningEffort
      })
    }
  }

  private async resumePersistedSession(): Promise<void> {
    const persisted = this.settings.get().chatCursorSessionId
    if (!persisted || this.session!.sessionId) return
    try {
      await this.resumeSession(persisted)
    } catch (error) {
      console.warn('[cursor] could not resume the saved session:', messageOf(error))
      await this.detachThread()
    }
  }

  private async resumeSession(sessionId: string): Promise<void> {
    const items = await this.session!.replay(sessionId)
    await this.session!.adopt(sessionId)
    this.transcript.replaceItems(items)
    this.threadName = null
    await this.settings.set({ chatCursorSessionId: sessionId, chatContinuation: null })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  private async detachThread(): Promise<void> {
    await this.session?.reset()
    this.transcript.clear()
    this.threadName = null
    this.activeTurnId = null
    this.turnContext = null
    await this.settings.set({ chatCursorSessionId: null })
  }

  private async ensureReady(): Promise<void> {
    await this.ensureConnected()
    if (this.connection.state === 'signed-out') throw new Error(SIGN_IN_MESSAGE)
    if (this.connection.state !== 'ready') throw new Error(this.connection.message)
  }

  private async ensureConnected(): Promise<void> {
    if (this.connection.state === 'ready' || this.connection.state === 'signed-out') return
    await this.start({ warm: true })
  }

  private async clearDeliveredHandoff(): Promise<void> {
    const continuation = this.settings.get().chatContinuation
    if (continuation?.handoff) await this.settings.set({ chatContinuation: { ...continuation, handoff: null } })
  }

  private turnAdditionalContext(prompt: string): ReturnType<typeof buildTurnAdditionalContext> {
    try {
      return buildTurnAdditionalContext(prompt, this.activeBrowserContext())
    } catch (error) {
      console.warn('[chat-context] could not capture active browser state:', messageOf(error))
      return undefined
    }
  }

  /** This conversation as the digest its successor carries, or null when there is nothing to carry. */
  private ownHandoff(): ThreadHandoffSource | null {
    const handoff = buildThreadHandoff(this.transcript.snapshot(), this.threadName)
    if (!handoff) return null
    return {
      ...handoff,
      provider: 'cursor',
      threadId: this.session?.sessionId ? cursorThreadId(this.session.sessionId) : null
    }
  }

  private applyOp(op: TranscriptOp): void {
    if (op.type === 'item') this.transcript.upsert(op.item)
    else if (op.type === 'delta') this.transcript.appendDelta(op.itemId, op.field, op.delta)
    else this.addNotice(op.text, op.tone)
  }

  private adoptSessionId(sessionId: string): void {
    void this.settings.set({ chatCursorSessionId: sessionId })
    this.bindBridge()
    this.emitEvent({ type: 'thread', threadId: cursorThreadId(sessionId), threadName: this.threadName })
  }

  /** ACP names the chat itself, a turn or two in; that title is what the header shows. */
  private adoptTitle(title: string): void {
    if (title === this.threadName) return
    this.threadName = title
    const sessionId = this.session?.sessionId
    if (sessionId) this.emitEvent({ type: 'thread', threadId: cursorThreadId(sessionId), threadName: title })
  }

  private onTurnEnd(turnId: string, end: TurnEnd): void {
    if (end.status === 'interrupted') this.addNotice('Turn stopped', 'info', turnId)
    if (end.status === 'failed') this.addNotice(end.error ?? 'The turn failed', 'error', turnId)
  }

  private addNotice(text: string, tone: 'info' | 'error', turnId: string | null = this.activeTurnId): void {
    this.transcript.addNotice(text, tone, turnId)
  }

  private setPlanUsage(usage: ChatPlanUsage): void {
    this.planUsage = usage
    this.emitEvent({ type: 'planUsage', usage })
  }

  private setConnection(connection: ChatConnection): void {
    this.connection = connection
    this.emitEvent({
      type: 'connection',
      provider: 'cursor',
      connection: { ...connection },
      account: this.account ? { ...this.account } : null,
      models: this.modelState.models.map((model) => ({ ...model })),
      selectedModel: this.modelState.selectedModel,
      selectedReasoningEffort: this.modelState.selectedReasoningEffort
    })
  }

  private setTurn(turnId: string | null): void {
    if (this.activeTurnId === turnId) return
    this.activeTurnId = turnId
    this.bindBridge()
    this.emitEvent({ type: 'turn', turnId })
  }

  /** Tool calls arrive on this pane's own bridge URL; the binding says which turn they belong to. */
  private bindBridge(): void {
    const sessionId = this.session?.sessionId ?? null
    this.bridge.bind(this.bridgeKey, {
      paneId: this.paneId,
      threadId: sessionId ? cursorThreadId(sessionId) : null,
      turnId: this.activeTurnId
    })
  }

  private setTurnContext(report: ChatTurnContextReport): void {
    this.turnContext = report
    this.emitEvent({ type: 'turnContext', report })
  }

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
  }
}
