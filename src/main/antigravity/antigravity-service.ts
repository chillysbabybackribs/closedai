import { EventEmitter } from 'node:events'
import type {
  ChatAccount, ChatAttachment, ChatConnection, ChatEvent, ChatSnapshot,
  ChatThreadSummary, ChatTurnContextReport
} from '../../shared/chat.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import { shrinkPastedImages } from '../chat-attachment-images.js'
import { buildThreadHandoff, handoffAdditionalContext } from '../chat-context/thread-handoff.js'
import { buildTurnAdditionalContext, type ActiveBrowserContext } from '../chat-context/turn-context.js'
import { buildTurnContextReport } from '../chat-context/turn-inspector.js'
import { ChatModelState } from '../chat-model-state.js'
import { messageOf } from '../chat-normalizers.js'
import { ChatTranscript } from '../chat-transcript.js'
import type { ScreenshotStore } from '../tools/capture/screenshot-store.js'
import { antigravityBinary, antigravityChatArgs, isAntigravityAuthFailure, runAntigravityCommand } from './antigravity-cli.js'
import { AntigravityHistory } from './antigravity-history.js'
import { antigravityConversationIdOf, antigravityThreadId } from './antigravity-ids.js'
import { buildAntigravityPrompt } from './antigravity-input.js'
import type { AntigravityToolBridge } from './antigravity-mcp.js'
import { antigravityModelCatalog, antigravityWireModel, parseAntigravityModelList } from './antigravity-models.js'
import { ensureAntigravityProfile, type AntigravityProfile } from './antigravity-profile.js'
import { AntigravitySession } from './antigravity-session.js'
import type { TranscriptOp, TurnEnd } from './antigravity-stream.js'

// The Antigravity provider, mirroring ChatService's surface so the hub can route to any of the
// three. Everything model-facing is Google's `agy` CLI on the user's subscription: the process
// per thread, the catalog (`agy models`), and the conversation store that backs the history.
// Tools reach the CLI through the shared HTTP MCP bridge (antigravity-mcp.ts).

const SIGN_IN_MESSAGE = 'Sign in to Antigravity: run `agy` in a terminal, complete the Google login, then choose an Antigravity model again.'

export class AntigravityChatService extends EventEmitter {
  private session: AntigravitySession | null = null
  private profile: AntigravityProfile | null = null
  private connection: ChatConnection = { state: 'starting', message: 'Starting Antigravity…' }
  private account: ChatAccount | null = null
  private readonly modelState = new ChatModelState()
  private readonly history: AntigravityHistory
  private threadName: string | null = null
  private activeTurnId: string | null = null
  private turnContext: ChatTurnContextReport | null = null
  private pendingHandoff: string | null = null
  private readonly transcript: ChatTranscript
  private startPromise: Promise<void> | null = null

  constructor(
    readonly cwd: string,
    private readonly settings: AppSettingsAccess,
    private readonly bridge: AntigravityToolBridge,
    private readonly stateDir: string,
    private readonly activeBrowserContext: () => ActiveBrowserContext | null = () => null,
    private readonly screenshots: Pick<ScreenshotStore, 'get'> | null = null,
    private readonly paneId: string | null = null
  ) {
    super()
    this.history = new AntigravityHistory(stateDir)
    this.transcript = new ChatTranscript(cwd, () => this.activeTurnId, (event) => this.emitEvent(event), (callId) => screenshots?.get(callId) ?? null)
  }

  snapshot(): ChatSnapshot {
    return {
      provider: 'antigravity',
      connection: { ...this.connection },
      account: this.account ? { ...this.account } : null,
      models: this.modelState.models.map((model) => ({ ...model })),
      selectedModel: this.modelState.selectedModel,
      selectedReasoningEffort: this.modelState.selectedReasoningEffort,
      cwd: this.cwd,
      threadId: this.session?.conversationId ? antigravityThreadId(this.session.conversationId) : null,
      threadName: this.threadName,
      activeTurnId: this.activeTurnId,
      contextUsage: null,
      turnContext: this.turnContext,
      items: this.transcript.snapshot()
    }
  }

  /** Read the catalog (which also proves sign-in), write the agent profile, and reopen the saved conversation. */
  start(options: { warm?: boolean } = {}): Promise<void> {
    this.startPromise ??= this.connect(options.warm === true).finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async send(text: string, attachments: ChatAttachment[] = []): Promise<void> {
    try {
      await this.ensureReady()
      const session = this.session!
      if (this.activeTurnId) throw new Error('An Antigravity turn is already running')
      const context = {
        ...this.turnAdditionalContext(text),
        ...(this.pendingHandoff ? handoffAdditionalContext(this.pendingHandoff) : {})
      }
      const turn = await buildAntigravityPrompt(text, shrinkPastedImages(attachments), Object.keys(context).length ? context : undefined, this.stateDir)
      if (!turn) return
      await this.bridge.start()
      this.transcript.addOptimisticUser(crypto.randomUUID(), turn.prompt, turn.summaries)
      session.send(turn.content)
      this.setTurnContext(buildTurnContextReport({
        provider: 'antigravity',
        model: this.modelState.selectedModel,
        threadId: session.conversationId ? antigravityThreadId(session.conversationId) : null,
        prompt: turn.prompt,
        attachments: turn.summaries,
        additionalContext: Object.keys(context).length ? context : undefined
      }))
      this.pendingHandoff = null
    } catch (error) {
      this.addNotice(messageOf(error), 'error')
      throw error
    }
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
    await this.session?.retire()
    this.emitEvent({ type: 'model', selectedModel: modelId, selectedReasoningEffort: preference.effort })
  }

  async selectReasoningEffort(effort: string): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before changing reasoning effort')
    const preference = this.modelState.preferenceForEffort(effort)
    if (this.modelState.selectedReasoningEffort === effort) return
    await this.settings.set({ chatReasoningEffort: effort })
    this.modelState.apply(preference)
    // Effort is part of the wire model name, so it takes effect with the next process.
    await this.session?.retire()
    this.emitEvent({ type: 'reasoningEffort', selectedReasoningEffort: effort })
  }

  listThreads(): Promise<ChatThreadSummary[]> {
    return this.history.listThreads(this.cwd)
  }

  /** Clear the pane; the next message starts a fresh conversation. */
  async newThread(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before starting a new chat')
    if (!this.session?.conversationId && this.transcript.isEmpty) return
    await this.detachThread()
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  async continueInNewThread(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before continuing in a new chat')
    const handoff = buildThreadHandoff(this.transcript.snapshot(), this.threadName)
    if (!handoff) throw new Error('There is no conversation to continue yet')
    await this.detachThread()
    this.pendingHandoff = handoff.text
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
    this.addNotice(`Continuing from “${handoff.title}”. A short summary of that chat goes with your next message.`, 'info', null)
  }

  async openThread(threadId: string): Promise<void> {
    const conversationId = antigravityConversationIdOf(threadId)
    if (!conversationId) throw new Error('Invalid thread')
    if (this.activeTurnId) throw new Error('Stop the current turn before switching chats')
    await this.ensureConnected()
    if (conversationId === this.session!.conversationId) return
    try {
      await this.resumeConversation(conversationId)
    } catch (error) {
      this.addNotice(`Could not open that chat: ${messageOf(error)}`, 'error')
      throw error
    }
  }

  async archiveThread(threadId: string): Promise<void> {
    const conversationId = antigravityConversationIdOf(threadId)
    if (!conversationId) throw new Error('Invalid thread')
    if (conversationId === this.session?.conversationId && this.activeTurnId) throw new Error('Stop the current turn before archiving this chat')
    await this.history.archive(conversationId)
    if (conversationId === this.session?.conversationId) await this.newThread()
  }

  stop(): void {
    void this.session?.retire()
  }

  private async connect(warm: boolean): Promise<void> {
    this.setConnection({ state: 'starting', message: 'Starting Antigravity…' })
    try {
      const listing = await runAntigravityCommand(['models'])
      if (!listing.ok) throw new Error(listing.stderr.trim() || listing.stdout.trim() || `agy models exited with ${listing.code ?? 'a signal'}`)
      const cliModels = parseAntigravityModelList(listing.stdout)
      if (cliModels.length === 0) throw new Error('agy models listed no models')
      const saved = this.settings.get()
      this.modelState.load(antigravityModelCatalog(cliModels, saved.chatModelId, saved.chatReasoningEffort))
      this.profile = await ensureAntigravityProfile(this.stateDir, { cwd: this.cwd })
      this.session ??= this.createSession()
      await this.resumePersistedConversation()
      this.account = { type: 'google', email: null, planType: null }
      this.setConnection({ state: 'ready', message: 'Antigravity is ready' })
      if (warm) await this.bridge.start()
    } catch (error) {
      const message = messageOf(error)
      this.setConnection(isAntigravityAuthFailure(message)
        ? { state: 'signed-out', message: SIGN_IN_MESSAGE }
        : { state: 'unavailable', message: `Antigravity is unavailable: ${message}` })
    }
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  private createSession(): AntigravitySession {
    return new AntigravitySession({
      cwd: this.cwd,
      binary: () => antigravityBinary(),
      spawnArgs: (resume) => antigravityChatArgs({
        workspace: this.cwd,
        model: antigravityWireModel(this.modelState.models, this.modelState.selectedModel, this.modelState.selectedReasoningEffort),
        resume,
        agent: this.profile ? { name: this.profile.agentName, root: this.profile.root } : null
      }),
      servers: () => this.bridge.servers(),
      displayScreenshot: (callId) => this.screenshots?.get(callId) ?? null,
      takeCallId: (conversationId, namespace, tool) => this.bridge.takeCallId(conversationId, namespace, tool),
      apply: (op) => this.applyOp(op),
      onTurn: (turnId) => this.setTurn(turnId),
      onConversationId: (conversationId) => this.adoptConversationId(conversationId),
      onTurnEnd: (turnId, end) => this.onTurnEnd(turnId, end),
      traceScope: () => ({ paneId: this.paneId, provider: 'antigravity', turnId: this.activeTurnId })
    })
  }

  private async resumePersistedConversation(): Promise<void> {
    const persisted = this.settings.get().chatAntigravityConversationId
    if (!persisted || this.session!.conversationId) return
    try {
      await this.resumeConversation(persisted)
    } catch (error) {
      console.warn('[antigravity] could not resume saved conversation:', messageOf(error))
      await this.detachThread()
    }
  }

  private async resumeConversation(conversationId: string): Promise<void> {
    const items = await this.history.loadTranscript(conversationId)
    await this.session!.adopt(conversationId)
    this.transcript.replaceItems(items ?? [])
    this.pendingHandoff = null
    this.threadName = await this.history.threadName(conversationId).catch(() => null)
    await this.settings.set({ chatAntigravityConversationId: conversationId })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
    if (!items) this.addNotice('Earlier messages of this chat were not recorded by ClosedAI; the conversation continues from where Antigravity left it.', 'info', null)
  }

  private async detachThread(): Promise<void> {
    const previous = this.session?.conversationId ?? null
    await this.session?.reset()
    if (previous) this.bridge.unbind(previous)
    this.transcript.clear()
    this.threadName = null
    this.pendingHandoff = null
    this.activeTurnId = null
    this.turnContext = null
    await this.settings.set({ chatAntigravityConversationId: null })
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

  private turnAdditionalContext(prompt: string): ReturnType<typeof buildTurnAdditionalContext> {
    try {
      return buildTurnAdditionalContext(prompt, this.activeBrowserContext())
    } catch (error) {
      console.warn('[chat-context] could not capture active browser state:', messageOf(error))
      return undefined
    }
  }

  private applyOp(op: TranscriptOp): void {
    if (op.type === 'item') this.transcript.upsert(op.item)
    else if (op.type === 'delta') this.transcript.appendDelta(op.itemId, op.field, op.delta)
    else this.addNotice(op.text, op.tone)
  }

  private adoptConversationId(conversationId: string): void {
    void this.settings.set({ chatAntigravityConversationId: conversationId })
    this.bindBridge()
    this.emitEvent({ type: 'thread', threadId: antigravityThreadId(conversationId), threadName: this.threadName })
  }

  /** Tool calls from the CLI carry the conversation id; the bridge maps it back to this pane and turn. */
  private bindBridge(): void {
    const conversationId = this.session?.conversationId
    if (!conversationId) return
    this.bridge.bind(conversationId, { paneId: this.paneId, threadId: antigravityThreadId(conversationId), turnId: this.activeTurnId })
  }

  private onTurnEnd(turnId: string, end: TurnEnd): void {
    if (end.status === 'interrupted') this.addNotice('Turn stopped', 'info', turnId)
    if (end.status === 'failed') this.addNotice(end.error ?? 'The turn failed', 'error', turnId)
    const conversationId = this.session?.conversationId
    if (!conversationId) return
    const items = this.transcript.snapshot()
    void Promise.all([this.history.saveTranscript(conversationId, items), this.history.recordThread(conversationId, this.cwd, items)])
      .catch((error: unknown) => { console.warn('[antigravity] could not record the conversation:', messageOf(error)) })
    void this.refreshThreadName(conversationId)
  }

  /** The CLI titles a conversation shortly after its first turn; pick that up for the header. */
  private async refreshThreadName(conversationId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const name = await this.history.threadName(conversationId).catch(() => null)
    if (!name || name === this.threadName || conversationId !== this.session?.conversationId) return
    this.threadName = name
    this.emitEvent({ type: 'thread', threadId: antigravityThreadId(conversationId), threadName: name })
  }

  private addNotice(text: string, tone: 'info' | 'error', turnId: string | null = this.activeTurnId): void {
    this.transcript.addNotice(text, tone, turnId)
  }

  private setConnection(connection: ChatConnection): void {
    this.connection = connection
    this.emitEvent({
      type: 'connection',
      provider: 'antigravity',
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

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
  }

  private setTurnContext(report: ChatTurnContextReport): void {
    this.turnContext = report
    this.emitEvent({ type: 'turnContext', report })
  }
}
