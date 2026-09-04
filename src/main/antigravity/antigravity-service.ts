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
import { buildCompactionSeed, compactedAdditionalContext } from '../chat-context/provider-compaction.js'
import { antigravityPlanUsage, planUsageUnavailable } from '../chat-context/plan-usage.js'
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

/** Fallback reading when the CLI does not report subscription usage or fails. */
const ANTIGRAVITY_PLAN_USAGE_UNAVAILABLE = planUsageUnavailable('The agy CLI does not report subscription usage.', 0)

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
  private planUsage: ChatPlanUsage | null = null
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

  snapshot(window?: ChatHistoryWindow): ChatSnapshot {
    const page = window ? this.transcript.page(window) : null
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
      planUsage: this.planUsage,
      turnContext: this.turnContext,
      items: page?.items ?? this.transcript.snapshot(),
      ...(page ? { history: { hasEarlier: page.hasEarlier, backgroundTasks: page.backgroundTasks } } : {})
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
      const pendingHandoff = this.settings.get().chatContinuation?.handoff ?? null
      const pendingCompaction = this.session!.takePendingSeed()
      const context = {
        ...this.turnAdditionalContext(text),
        ...(pendingHandoff ? handoffAdditionalContext(pendingHandoff) : {}),
        ...(pendingCompaction ? compactedAdditionalContext(pendingCompaction) : {})
      }
      const turn = await buildAntigravityPrompt(text, shrinkPastedImages(attachments), Object.keys(context).length ? context : undefined, this.stateDir)
      if (!turn) return
      await this.bridge.start()
      // The CLI reads the agent file once, at process start. A spawn is therefore the only
      // moment its instructions — including the repository map — can be brought up to date.
      if (!session.live) this.profile = await ensureAntigravityProfile(this.stateDir, { cwd: this.cwd })
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
      await this.clearDeliveredHandoff()
    } catch (error) {
      this.addNotice(messageOf(error), 'error')
      throw error
    }
  }

  /**
   * Read the account's plan windows via `agy -p /quota --output-format json`. Safe while a
   * turn runs, so the hover card can ask for a fresh reading every time it opens.
   */
  async refreshPlanUsage(): Promise<void> {
    if (this.connection.state !== 'ready') return
    try {
      const result = await runAntigravityCommand(['-p', '/quota', '--output-format', 'json'])
      if (!result.ok) {
        if (!this.planUsage) this.setPlanUsage(ANTIGRAVITY_PLAN_USAGE_UNAVAILABLE)
        return
      }
      const parsed = JSON.parse(result.stdout) as unknown
      const usage = antigravityPlanUsage(parsed)
      if (usage) {
        this.setPlanUsage(usage)
      } else if (!this.planUsage) {
        this.setPlanUsage(ANTIGRAVITY_PLAN_USAGE_UNAVAILABLE)
      }
    } catch (error) {
      console.warn('[antigravity] could not read plan usage:', messageOf(error))
      if (!this.planUsage) this.setPlanUsage(ANTIGRAVITY_PLAN_USAGE_UNAVAILABLE)
    }
  }

  private setPlanUsage(usage: ChatPlanUsage | null): void {
    if (!usage) return
    this.planUsage = usage
    this.emitEvent({ type: 'planUsage', usage })
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

  async readThread(threadId: string): Promise<ChatThreadContent> {
    const conversationId = antigravityConversationIdOf(threadId)
    if (!conversationId) throw new Error('Invalid Antigravity thread')
    const items = await this.history.loadTranscript(conversationId)
    if (!items) throw new Error('Earlier messages of this Antigravity chat were not recorded by ClosedAI')
    const threadName = await this.history.threadName(conversationId).catch(() => null)
    return { threadId, threadName, items }
  }

  /** Clear the pane; the next message starts a fresh conversation. */
  async newThread(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before starting a new chat')
    if (!this.session?.conversationId && this.transcript.isEmpty && !this.settings.get().chatContinuation) return
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

  /** This conversation as the digest its successor carries, or null when there is nothing to carry. */
  private ownHandoff(): ThreadHandoffSource | null {
    const handoff = buildThreadHandoff(this.transcript.snapshot(), this.threadName)
    if (!handoff) return null
    return { ...handoff, provider: 'antigravity', threadId: this.session?.conversationId ? antigravityThreadId(this.session.conversationId) : null }
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

  /** Re-seed the CLI thread from a bounded transcript summary; the visible transcript is unchanged. */
  async compactConversation(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before compacting')
    const seed = buildCompactionSeed(this.transcript.snapshot(), this.threadName)
    if (!seed) throw new Error('There is no conversation to compact yet')
    const previous = this.session?.conversationId ?? null
    if (!this.session) this.session = this.createSession()
    await this.session.compact(seed)
    if (previous) this.bridge.unbind(previous)
    await this.settings.set({ chatAntigravityConversationId: null })
    this.addNotice('Conversation context compacted; the next message continues from a summary.', 'info', null)
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
      void this.refreshPlanUsage()
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
    this.threadName = await this.history.threadName(conversationId).catch(() => null)
    await this.settings.set({ chatAntigravityConversationId: conversationId, chatContinuation: null })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
    if (!items) this.addNotice('Earlier messages of this chat were not recorded by ClosedAI; the conversation continues from where Antigravity left it.', 'info', null)
  }

  private async detachThread(): Promise<void> {
    const previous = this.session?.conversationId ?? null
    await this.session?.reset()
    if (previous) this.bridge.unbind(previous)
    this.transcript.clear()
    this.threadName = null
    this.activeTurnId = null
    this.turnContext = null
    await this.settings.set({ chatAntigravityConversationId: null })
  }

  private async ensureReady(): Promise<void> {
    await this.ensureConnected()
    if (this.connection.state === 'signed-out') throw new Error(SIGN_IN_MESSAGE)
    if (this.connection.state !== 'ready') throw new Error(this.connection.message)
  }

  private async clearDeliveredHandoff(): Promise<void> {
    const continuation = this.settings.get().chatContinuation
    if (continuation?.handoff) await this.settings.set({ chatContinuation: { ...continuation, handoff: null } })
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
    if (turnId === null) void this.refreshPlanUsage()
  }

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
  }

  private setTurnContext(report: ChatTurnContextReport): void {
    this.turnContext = report
    this.emitEvent({ type: 'turnContext', report })
  }
}
