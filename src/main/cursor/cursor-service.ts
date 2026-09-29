import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  ChatAccount, ChatAttachment, ChatConnection, ChatEvent, ChatHistoryWindow, ChatPlanUsage,
  ChatSnapshot, ChatThreadContent, ChatThreadSummary
} from '../../shared/chat.js'
import type { RotationSettingsAccess } from '../chat-context/rotate-provider-session.js'
import { createSessionRotator } from '../chat-context/session-rotator-factory.js'
import { buildProviderChildEnv } from '../provider-work-env.js'
import type { SessionRotator } from '../chat-context/session-rotation.js'
import {
  carryLostCursorSession,
  detachCursorThread,
  resumeCursorSession,
  resumePersistedCursorSession,
  rotateCursorProviderSession,
  type CursorThreadHost
} from './cursor-thread-lifecycle.js'
import { shrinkPastedImages } from '../chat-attachment-images.js'
import {
  buildThreadHandoff,
  continuationFromThreadHandoff,
  type ThreadHandoffSource
} from '../chat-context/thread-handoff.js'
import {
  buildTurnSendContext,
  markSessionGuideDelivered,
  sessionGuideThreadKey,
  type SessionGuideDeliveryState
} from '../chat-context/session-guide.js'
import {
  buildTurnAdditionalContext,
  type TurnSurfaceContext
} from '../chat-context/turn-context.js'
import { reasoningEffortForModel } from '../chat-model-catalog.js'
import { ChatModelState } from '../chat-model-state.js'
import { buildChatInput } from '../chat-input.js'
import { messageOf } from '../chat-normalizers.js'
import { ChatTranscript } from '../chat-transcript.js'
import type { ScreenshotStore } from '../tools/capture/screenshot-store.js'
import { PROVIDER_CATALOG_TTL_MS, type WorkspaceCatalogs } from '../chat-context/provider-catalog-cache.js'
import type { AcpSessionSetup } from './cursor-acp.js'
import { CursorArchive } from './cursor-archive.js'
import type { CursorToolBridge } from './cursor-mcp.js'
import { isCursorAuthFailure, parseCursorAccountEmail, parseCursorPlan, readCursorAbout } from './cursor-cli.js'
import { isMissingExecutable, missingProviderMessage } from '../provider-binary.js'
import { cursorSessionIdOf, cursorThreadId, cursorTurnId } from './cursor-ids.js'
import { buildCursorPrompt } from './cursor-input.js'
import { cursorAcpModelId, cursorModelCatalog } from './cursor-models.js'
import { CursorSession } from './cursor-session.js'
import { applyTranscriptOp, handleProviderTurnEnd, type TranscriptOp, type TurnEnd } from '../chat-transcript-ops.js'
import { generatePromptSuggestion } from '../chat-prompt-suggestions.js'

// The Cursor provider, mirroring ChatService's surface so the hub can route to any of the four.
// Everything model-facing is the `cursor-agent acp` server on the user's Cursor subscription:
// one long-lived JSON-RPC process per pane, the catalog that `session/new` reports, and the
// session store the agent itself keeps — `session/list` is the chat history and `session/load`
// replays a transcript, so unlike the Antigravity lane this provider records nothing of its own.

const LOST_SESSION_NOTICE = 'Cursor no longer had this conversation, so it continues in a new session with a summary of the chat.'
const SIGN_IN_MESSAGE = 'Sign in to Cursor: run `cursor-agent login` in a terminal, complete the browser login, then choose a Cursor model again.'

export class CursorChatService extends EventEmitter {
  private session: CursorSession | null = null
  private connection: ChatConnection = { state: 'starting', message: 'Starting Cursor…' }
  private account: ChatAccount | null = null
  private readonly modelState = new ChatModelState()
  private readonly archive: CursorArchive
  private threadName: string | null = null
  private activeTurnId: string | null = null
  private pausedTurnId: string | null = null
  private planUsage: ChatPlanUsage | null = null
  private readonly transcript: ChatTranscript
  private startPromise: Promise<void> | null = null
  /** Set from the handshake; images are only put on the wire when the agent accepts them. */
  private supportsImages = true
  /**
   * This pane's key in the tool bridge URLs. One per pane rather than per session: the key names
   * the caller, and a pane has one thread at a time, so it survives every new chat and reload.
   */
  private readonly bridgeKey = randomUUID()
  private readonly sessionGuideState: SessionGuideDeliveryState = { lastDeliveredThreadKey: null }
  private promptSuggestion: string | null = null
  private suggestionGeneration = 0
  private readonly rotator: SessionRotator

  constructor(
    readonly cwd: string,
    private readonly settings: RotationSettingsAccess,
    private readonly bridge: CursorToolBridge,
    stateDir: string,
    private readonly surfaceContext: () => TurnSurfaceContext | null = () => null,
    private readonly screenshots: Pick<ScreenshotStore, 'get'> | null = null,
    private readonly paneId: string | null = null,
    private readonly catalogs: WorkspaceCatalogs | null = null
  ) {
    super()
    this.archive = new CursorArchive(stateDir)
    this.transcript = new ChatTranscript(
      cwd,
      () => this.activeTurnId,
      (event) => this.emitEvent(event),
      (callId) => screenshots?.get(callId) ?? null
    )
    this.rotator = createSessionRotator({
      settings: this.settings,
      threadId: () => (this.session?.sessionId ? cursorThreadId(this.session.sessionId) : null),
      turnActive: () => this.activeTurnId !== null,
      transcriptItems: () => this.transcript.snapshot(),
      rotate: () => this.rotateProviderSession()
    })
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
      pausedTurnId: this.pausedTurnId,
      contextUsage: null,
      planUsage: this.planUsage,
      items: page?.items ?? this.transcript.snapshot(),
      promptSuggestion: this.promptSuggestion,
      ...(page ? { history: { hasEarlier: page.hasEarlier, backgroundTasks: page.backgroundTasks } } : {})
    }
  }

  hasRunningBackground(): boolean {
    return this.transcript.hasRunningBackground()
  }

  /** Open the ACP server (which also proves sign-in), read the catalog, and reopen the saved session. */
  start(options: { warm?: boolean } = {}): Promise<void> {
    this.startPromise ??= this.connect(options.warm === true).finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async send(text: string, attachments: ChatAttachment[] = [], prepare?: () => Promise<void>): Promise<void> {
    let turnId: string | null = null
    try {
      const shrunk = shrinkPastedImages(attachments)
      const { prompt, input, summaries } = buildChatInput(text, shrunk)
      if (input.length === 0) return
      if (this.activeTurnId) throw new Error('A Cursor turn is already running')
      const transcriptWasEmpty = this.transcript.isEmpty
      // Paint the accepted message before the provider starts; see the Claude lane for why.
      this.transcript.addOptimisticUser(randomUUID(), prompt, summaries)
      await prepare?.()
      await this.rotator.prepareForSend()
      await this.ensureReady()
      const session = this.session!
      if (this.activeTurnId) throw new Error('A Cursor turn is already running')
      turnId = cursorTurnId()
      this.setTurn(turnId)
      session.beginTurn(turnId)
      // Open the session before the prompt is assembled: a saved session the agent no longer holds
      // is replaced here, and the conversation it carried has to reach this turn's context.
      await session.warm()
      const sessionId = session.sessionId
      const pendingHandoff = this.settings.get().chatContinuation?.handoff ?? null
      const guideThreadKey = sessionGuideThreadKey(
        this.settings.get().chatCursorSessionId,
        session.sessionId,
        this.paneId ?? 'pane'
      )
      const { context, attachGuide } = buildTurnSendContext({
        threadKey: guideThreadKey,
        state: this.sessionGuideState,
        transcriptWasEmpty,
        pendingHandoff,
        browserContext: this.turnAdditionalContext(text)
      })
      const turn = await buildCursorPrompt(
        text,
        shrunk,
        context,
        { images: this.supportsImages }
      )
      if (!turn) {
        session.abortTurn(turnId)
        this.setTurn(null)
        return
      }
      if (this.session !== session || (sessionId && session.sessionId !== sessionId) || this.activeTurnId !== turnId) {
        throw new Error('Cursor conversation changed while preparing the turn')
      }
      await session.send(turn.blocks, turnId)
      await this.clearDeliveredHandoff()
      if (attachGuide) markSessionGuideDelivered(this.sessionGuideState, guideThreadKey)
    } catch (error) {
      if (turnId) this.session?.abortTurn(turnId)
      if (turnId && this.activeTurnId === turnId) this.setTurn(null)
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
    const about = await readCursorAbout()
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
    const acpModelId = cursorAcpModelId(modelId)
    // ACP changes the model on the live session, so an open chat keeps its history.
    if (acpModelId) {
      try {
        await this.session?.selectModel(acpModelId)
      } catch (error) {
        this.addNotice(`Cursor did not accept that model: ${messageOf(error)}`, 'error')
        throw error
      }
    }
    // Commit the preference only after a live session accepts it; a rejected selection must not
    // leave the composer claiming a model the session is not using.
    await this.settings.set({ chatModelId: modelId, chatReasoningEffort: preference.effort })
    this.modelState.apply(preference)
    this.emitEvent({ type: 'model', selectedModel: modelId, selectedReasoningEffort: preference.effort })
  }

  /**
   * Cursor bakes the effort into the model id the agent accepts — its model config rejects
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

  async readThread(threadId: string, cwd = this.cwd): Promise<ChatThreadContent> {
    const sessionId = cursorSessionIdOf(threadId)
    if (!sessionId) throw new Error('Invalid Cursor thread')
    await this.ensureConnected()
    const items = await this.session!.replay(sessionId, cwd)
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
      chatContinuation: continuationFromThreadHandoff(this.paneId, source)
    })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
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

  async compactConversation(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before compacting')
    if (!this.settings.get().chatSeamlessRotation) throw new Error('The active provider does not support compaction')
    await this.rotateProviderSession()
    this.addNotice('Provider context will shrink on the next message; the visible transcript is unchanged.', 'info', null)
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

  dispose(): void {
    this.transcript.stopBackgroundTasks('The Cursor session ended before this task reported completion.')
    this.stop()
  }

  /**
   * Starting Cursor used to cost three serial waits before the pane could be used: the ACP
   * handshake (~1s), a `session/new` purely to read the catalog (~1.5s), and `cursor-agent about`
   * for the account (~1.5s). The catalog now comes from the workspace's cached reading when there
   * is one, so a start that only needs the picker spawns nothing at all; the account is read
   * behind the ready state rather than in front of it; and the pane's saved session is what any
   * open loads, so warming continues the conversation instead of minting a new session beside it.
   */
  private async connect(warm: boolean): Promise<void> {
    this.setConnection({ state: 'starting', message: 'Starting Cursor…' })
    try {
      this.session ??= this.createSession()
      this.session.adoptSaved(this.settings.get().chatCursorSessionId)
      // A saved-session replay also supplies the catalog. Load it first so an uncached
      // catalog does not cause an initial load whose history would be discarded.
      if (warm) await resumePersistedCursorSession(this.threadHost(), this.session)
      const cachedCatalog = this.loadCachedCatalog()
      if (!cachedCatalog) {
        const setup = await this.session.warm()
        if (setup.models.length === 0) throw new Error('Cursor reported no available models')
        this.supportsImages = this.session.capabilities?.image !== false
      } else if (warm) {
        // A cached catalog skips the warm that would otherwise open the agent and session. Prefetch
        // behind ready so the first send is not serial on process spawn plus MCP attach alone.
        void this.prefetchTurnPath()
        this.supportsImages = this.session.capabilities?.image !== false
      } else {
        this.supportsImages = this.session.capabilities?.image !== false
      }
      this.setConnection({ state: 'ready', message: 'Cursor is ready' })
      void this.readAccount()
      if (!warm) await this.session.retire()
      void this.refreshPlanUsage()
    } catch (error) {
      const message = messageOf(error)
      this.setConnection(isMissingExecutable(error)
        ? { state: 'unavailable', message: missingProviderMessage('cursor') }
        : isCursorAuthFailure(message)
          ? { state: 'signed-out', message: SIGN_IN_MESSAGE }
          : { state: 'unavailable', message: `Cursor is unavailable: ${message}` })
    }
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  /**
   * `about` is the only place the signed-in email appears, and it is a whole `cursor-agent`
   * process. It runs behind the ready state: the pane is usable while it lands, and the account
   * it names — or the sign-out it reports — is announced when it does.
   */
  private async readAccount(): Promise<void> {
    const about = await readCursorAbout()
    const email = about.ok ? parseCursorAccountEmail(about.stdout) : null
    this.account = { type: 'other', email, planType: about.ok ? parseCursorPlan(about.stdout) : null }
    if (about.ok && !email && this.connection.state === 'ready') {
      this.setConnection({ state: 'signed-out', message: SIGN_IN_MESSAGE })
      return
    }
    // The account is part of the connection the pane shows, so it is announced when it lands.
    this.setConnection({ ...this.connection })
  }

  /**
   * The workspace's last reading of the Cursor catalog. Reading one costs a process and a session,
   * so a pane that has one skips both; the entry is refreshed whenever a session reports its own.
   */
  private loadCachedCatalog(): boolean {
    if (this.modelState.models.length > 0) return true
    const models = this.catalogs?.read('cursor', PROVIDER_CATALOG_TTL_MS)?.models ?? []
    if (models.length === 0) return false
    const saved = this.settings.get()
    // `isDefault` records the model the agent itself was on when the catalog was read, so a pane
    // whose saved pick is gone still opens on the model Cursor would have chosen.
    const selectedModel = models.some((model) => model.id === saved.chatModelId)
      ? saved.chatModelId
      : models.find((model) => model.isDefault)?.id ?? models[0]!.id
    this.modelState.load({
      models,
      selectedModel,
      selectedReasoningEffort: reasoningEffortForModel(models, selectedModel, saved.chatReasoningEffort)
    })
    return true
  }

  private createSession(): CursorSession {
    return new CursorSession({
      cwd: this.cwd,
      // The bridge is started here rather than at the call sites that open sessions: a session is
      // told about the ClosedAI tools exactly once, when it opens, so a pane that warmed or
      // replayed its session before the listener existed would otherwise run every later turn
      // against an agent that was never given them.
      mcpServers: async () => {
        // A listener that cannot bind must not cost the pane its chat: warming stays usable and
        // the turn path's own `bridge.start()` reports the failure where it can be acted on.
        await this.bridge.start().catch((error: unknown) => {
          console.warn('[cursor] tool bridge unavailable; this session opens without ClosedAI tools:', messageOf(error))
        })
        return this.bridge.servers(this.bridgeKey)
      },
      modelId: () => cursorAcpModelId(this.modelState.selectedModel),
      apply: (op) => this.applyOp(op),
      onTurn: (turnId) => this.setTurn(turnId),
      onSessionId: (sessionId) => this.adoptSessionId(sessionId),
      onSessionSaved: (sessionId) => { void this.settings.set({ chatCursorSessionId: sessionId }) },
      onSessionLost: async (sessionId) => {
        if (await carryLostCursorSession(this.threadHost(), sessionId)) this.addNotice(LOST_SESSION_NOTICE, 'info')
      },
      onSetup: (setup) => this.adoptSetup(setup),
      onTitle: (title) => this.adoptTitle(title),
      onTurnEnd: (turnId, end) => this.onTurnEnd(turnId, end),
      displayScreenshot: (callId) => this.screenshots?.get(callId) ?? null,
      takeCallId: (namespace, tool) => this.bridge.takeCallId(this.bridgeKey, namespace, tool),
      traceScope: () => ({ paneId: this.paneId, provider: 'cursor', turnId: this.activeTurnId }),
      childEnv: () => buildProviderChildEnv({
        workspaceCwd: this.cwd,
        paneId: this.paneId,
        workLockEnabled: this.settings.get().chatWorkLockEnabled !== false
      })
    })
  }

  /** Every session open re-reports the catalog, which is where the model list comes from. */
  private adoptSetup(setup: AcpSessionSetup): void {
    if (setup.models.length === 0) return
    const saved = this.settings.get()
    const previous = this.modelState.selectedModel
    this.modelState.load(cursorModelCatalog(setup.models, setup.currentModelId, saved.chatModelId, saved.chatReasoningEffort))
    this.catalogs?.remember('cursor', this.modelState.models, setup.models)
    if (this.modelState.selectedModel !== previous) {
      this.emitEvent({
        type: 'model',
        selectedModel: this.modelState.selectedModel ?? '',
        selectedReasoningEffort: this.modelState.selectedReasoningEffort
      })
    }
  }

  /**
   * Bring the saved conversation back. The condition is the pane's own transcript, not the
   * session id: startup adopts that id before replay, and keying on it meant a
   * restarted pane silently skipped its history and answered from an empty session.
   */
  private async resumeSession(sessionId: string): Promise<void> {
    await resumeCursorSession(this.threadHost(), this.session!, sessionId)
  }

  private async detachThread(): Promise<void> {
    await detachCursorThread(this.threadHost(), this.session)
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

  private prefetchTurnPath(): void {
    void this.bridge.start().catch((error: unknown) => {
      console.warn('[cursor] tool bridge prefetch failed:', messageOf(error))
    })
    void this.session?.warm().then((setup) => {
      this.supportsImages = this.session!.capabilities?.image !== false
      if (setup.models.length > 0) this.adoptSetup(setup)
    }).catch((error: unknown) => {
      console.warn('[cursor] session prefetch failed:', messageOf(error))
    })
  }

  private async clearDeliveredHandoff(): Promise<void> {
    const continuation = this.settings.get().chatContinuation
    if (continuation?.handoff) await this.settings.set({ chatContinuation: { ...continuation, handoff: null } })
  }

  private turnAdditionalContext(prompt: string): ReturnType<typeof buildTurnAdditionalContext> {
    try {
      return buildTurnAdditionalContext(prompt, this.surfaceContext())
    } catch (error) {
      console.warn('[chat-context] could not capture the pane's browser or note state:', messageOf(error))
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
    applyTranscriptOp(this.transcript, (text, tone) => this.addNotice(text, tone), op)
  }

  private adoptSessionId(sessionId: string): void {
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
    handleProviderTurnEnd(turnId, end, {
      addNotice: (text, tone, id) => this.addNotice(text, tone, id),
      setPaused: (id) => this.setPaused(id)
    })
    if (end.status === 'completed') {
      const answer = this.transcript.snapshot()
        .flatMap((item) => item.type === 'assistant' && item.turnId === turnId ? [item.text] : [])
        .join('\n').trim()
      void this.updatePromptSuggestion(answer)
    }
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
    if (turnId) {
      this.setPaused(null)
      this.suggestionGeneration += 1
      this.setPromptSuggestion(null)
      this.rotator.turnStarted()
    }
    this.bindBridge()
    this.emitEvent({ type: 'turn', turnId })
    if (turnId === null) this.rotator.turnFinished()
  }

  private async rotateProviderSession(): Promise<void> {
    try {
      await rotateCursorProviderSession(this.threadHost(), this.session)
    } finally {
      this.rotator.complete()
    }
  }

  private async updatePromptSuggestion(answer: string): Promise<void> {
    if (!answer) return
    const generation = ++this.suggestionGeneration
    const sessionId = this.session?.sessionId
    const suggestion = await generatePromptSuggestion('cursor', cursorAcpModelId(this.modelState.selectedModel), answer)
    if (this.activeTurnId || generation !== this.suggestionGeneration || this.session?.sessionId !== sessionId || !suggestion) return
    this.setPromptSuggestion(suggestion)
  }

  private setPromptSuggestion(suggestion: string | null): void {
    if (this.promptSuggestion === suggestion) return
    this.promptSuggestion = suggestion
    if (suggestion === null) this.suggestionGeneration += 1
    this.emitEvent({ type: 'promptSuggestion', suggestion })
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

  /**
   * Remember the turn the pause button ended, so the composer can offer Resume until the next
   * turn starts. Cleared by any new turn, including the resuming one.
   */
  private setPaused(turnId: string | null): void {
    if (this.pausedTurnId === turnId) return
    this.pausedTurnId = turnId
    this.emitEvent({ type: 'paused', turnId })
  }

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
  }

  private threadHost(): CursorThreadHost {
    return {
      settings: this.settings,
      paneId: this.paneId,
      transcript: this.transcript,
      rotator: this.rotator,
      session: () => this.session,
      threadName: () => this.threadName,
      setThreadName: (name) => { this.threadName = name },
      setActiveTurnId: (id) => { this.activeTurnId = id },
      transcriptEmpty: () => this.transcript.isEmpty,
      activeTurnId: () => this.activeTurnId,
      snapshot: () => this.snapshot(),
      emitEvent: (event) => this.emitEvent(event)
    }
  }
}
