import { EventEmitter } from 'node:events'
import type {
  ChatAccount, ChatAttachment, ChatConnection, ChatEvent, ChatHistoryWindow, ChatPlanUsage,
  ChatSnapshot, ChatThreadContent, ChatThreadSummary
} from '../../shared/chat.js'
import type { RotationSettingsAccess } from '../chat-context/rotate-provider-session.js'
import { describeUsage, type ContextUsage } from '../chat-context/context-compaction.js'
import { createSessionRotator } from '../chat-context/session-rotator-factory.js'
import type { SessionRotator } from '../chat-context/session-rotation.js'
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
  mergeTurnAdditionalContext,
  type ActiveBrowserContext
} from '../chat-context/turn-context.js'
import { buildCompactionSeed, compactedAdditionalContext } from '../chat-context/provider-compaction.js'
import { PROVIDER_CATALOG_TTL_MS, type WorkspaceCatalogs } from '../chat-context/provider-catalog-cache.js'
import { buildChatInput } from '../chat-input.js'
import { ChatModelState } from '../chat-model-state.js'
import { messageOf } from '../chat-normalizers.js'
import { isMissingExecutable, missingProviderMessage } from '../provider-binary.js'
import { ChatTranscript } from '../chat-transcript.js'
import type { ScreenshotStore } from '../tools/capture/screenshot-store.js'
import { antigravityBinary, antigravityChatArgs, isAntigravityAuthFailure, runAntigravityCommand } from './antigravity-cli.js'
import { AntigravityHistory } from './antigravity-history.js'
import { antigravityConversationIdOf, antigravityThreadId } from './antigravity-ids.js'
import { buildAntigravityPrompt } from './antigravity-input.js'
import type { AntigravityToolBridge } from './antigravity-mcp.js'
import {
  antigravityContextWindow,
  antigravityModelCatalog,
  antigravityWireModel,
  parseAntigravityModelList,
  type AntigravityCliModel
} from './antigravity-models.js'
import { ensureAntigravityProfile, type AntigravityProfile } from './antigravity-profile.js'
import { AntigravitySession } from './antigravity-session.js'
import { applyTranscriptOp, handleProviderTurnEnd, type TranscriptOp, type TurnEnd } from '../chat-transcript-ops.js'
import {
  ANTIGRAVITY_PLAN_USAGE_UNAVAILABLE,
  ANTIGRAVITY_QUOTA_REUSE_MS,
  cachedAntigravityPlanUsage,
  readAntigravityPlanUsage
} from './antigravity-quota.js'
import {
  detachAntigravityThread,
  resumeAntigravityConversation,
  resumePersistedAntigravityConversation,
  rotateAntigravityProviderSession,
  type AntigravityThreadHost
} from './antigravity-thread-lifecycle.js'
import {
  retryAntigravityOnAuthFailure,
  retryAntigravityWithoutUndeclaredTools,
  type AntigravityTurnRecoveryHost
} from './antigravity-turn-recovery.js'
import { generatePromptSuggestion } from '../chat-prompt-suggestions.js'

export { ANTIGRAVITY_QUOTA_REUSE_MS, forgetAntigravityQuota } from './antigravity-quota.js'

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
  private pausedTurnId: string | null = null
  private planUsage: ChatPlanUsage | null = null
  private contextUsage: ContextUsage | null = null
  /** stdin content of the running turn, so a grant rejection can replay it on a rewritten profile. */
  private lastTurnContent: string | null = null
  private authRetrying = false
  private readonly transcript: ChatTranscript
  private startPromise: Promise<void> | null = null
  private readonly sessionGuideState: SessionGuideDeliveryState = { lastDeliveredThreadKey: null }
  private promptSuggestion: string | null = null
  private suggestionGeneration = 0
  private readonly rotator: SessionRotator

  constructor(
    readonly cwd: string,
    private readonly settings: RotationSettingsAccess,
    private readonly bridge: AntigravityToolBridge,
    private readonly stateDir: string,
    private readonly activeBrowserContext: () => ActiveBrowserContext | null = () => null,
    private readonly screenshots: Pick<ScreenshotStore, 'get'> | null = null,
    private readonly paneId: string | null = null,
    private readonly catalogs: WorkspaceCatalogs | null = null
  ) {
    super()
    this.history = new AntigravityHistory(stateDir)
    this.transcript = new ChatTranscript(cwd, () => this.activeTurnId, (event) => this.emitEvent(event), (callId) => screenshots?.get(callId) ?? null)
    this.rotator = createSessionRotator({
      settings: this.settings,
      threadId: () => (this.session?.conversationId ? antigravityThreadId(this.session.conversationId) : null),
      turnActive: () => this.activeTurnId !== null,
      transcriptItems: () => this.transcript.snapshot(),
      currentUsage: () => this.contextUsage,
      notice: (text) => this.addNotice(text, 'info', null),
      rotate: () => this.rotateProviderSession()
    })
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
      pausedTurnId: this.pausedTurnId,
      contextUsage: describeUsage(this.contextUsage),
      planUsage: this.planUsage,
      items: page?.items ?? this.transcript.snapshot(),
      promptSuggestion: this.promptSuggestion,
      ...(page ? { history: { hasEarlier: page.hasEarlier, backgroundTasks: page.backgroundTasks } } : {})
    }
  }

  hasRunningBackground(): boolean {
    return this.transcript.hasRunningBackground()
  }

  /** Read the catalog (which also proves sign-in), write the agent profile, and reopen the saved conversation. */
  start(options: { warm?: boolean } = {}): Promise<void> {
    this.startPromise ??= this.connect(options.warm === true).finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async send(text: string, attachments: ChatAttachment[] = [], prepare?: () => Promise<void>): Promise<void> {
    try {
      const shrunk = shrinkPastedImages(attachments)
      const { prompt, input, summaries } = buildChatInput(text, shrunk)
      if (input.length === 0) return
      if (this.activeTurnId) throw new Error('An Antigravity turn is already running')
      const transcriptWasEmpty = this.transcript.isEmpty
      // Paint the accepted message before the provider starts; see the Claude lane for why.
      this.transcript.addOptimisticUser(crypto.randomUUID(), prompt, summaries)
      await prepare?.()
      await this.rotator.prepareForSend()
      await this.ensureReady()
      const session = this.session!
      if (this.activeTurnId) throw new Error('An Antigravity turn is already running')
      const conversationId = session.conversationId
      const pendingHandoff = this.settings.get().chatContinuation?.handoff ?? null
      const pendingCompaction = this.session!.takePendingSeed()
      const guideThreadKey = sessionGuideThreadKey(
        this.settings.get().chatAntigravityConversationId,
        session.conversationId,
        this.paneId ?? 'pane'
      )
      const { context: guided, attachGuide } = buildTurnSendContext({
        threadKey: guideThreadKey,
        state: this.sessionGuideState,
        transcriptWasEmpty,
        pendingHandoff,
        browserContext: this.turnAdditionalContext(text)
      })
      const context = mergeTurnAdditionalContext(
        guided,
        pendingCompaction ? compactedAdditionalContext(pendingCompaction) : undefined
      )
      const turn = await buildAntigravityPrompt(text, shrunk, context, this.stateDir)
      if (!turn) return
      await this.bridge.start()
      // The CLI reads the agent file once, at process start. A spawn is therefore the only
      // moment its instructions — including the repository map — can be brought up to date.
      if (!session.live) this.profile = await ensureAntigravityProfile(this.stateDir, { cwd: this.cwd })
      if (this.session !== session || (conversationId && session.conversationId !== conversationId) || this.activeTurnId) throw new Error('Antigravity conversation changed while preparing the turn')
      this.lastTurnContent = turn.content
      this.authRetrying = false
      session.send(turn.content)
      await this.clearDeliveredHandoff()
      if (attachGuide) markSessionGuideDelivered(this.sessionGuideState, guideThreadKey)
    } catch (error) {
      this.addNotice(messageOf(error), 'error')
      throw error
    }
  }

  /**
   * Read the account's plan windows via `agy -p /quota --output-format json`. Safe while a
   * turn runs, so the hover card and a turn ending both ask for it — but a reading any pane took
   * within `reuseWithinMs` (a minute by default) is shown instead of spawning again, since the
   * quota moves per turn and every pane of the account reads the same number.
   */
  async refreshPlanUsage(reuseWithinMs = ANTIGRAVITY_QUOTA_REUSE_MS): Promise<void> {
    if (this.connection.state !== 'ready') return
    const reading = await readAntigravityPlanUsage(reuseWithinMs)
    if (reading === 'reuse') {
      const cached = cachedAntigravityPlanUsage()
      if (cached) this.setPlanUsage(cached)
      return
    }
    if (reading === 'unchanged') {
      if (!this.planUsage) this.setPlanUsage(ANTIGRAVITY_PLAN_USAGE_UNAVAILABLE)
      return
    }
    this.setPlanUsage(reading)
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
    this.emitEvent({ type: 'model', selectedModel: modelId, selectedReasoningEffort: preference.effort })
    if (this.contextUsage) {
      const model = this.modelState.models.find((entry) => entry.id === modelId)
      const contextWindow = model?.contextWindow ?? antigravityContextWindow(modelId)
      this.contextUsage = { usedTokens: this.contextUsage.usedTokens, contextWindow }
      this.emitEvent({ type: 'context', usage: describeUsage(this.contextUsage) })
    }
    // The model is part of the wire process; the live one winds down behind the pick, not in front of it.
    this.retireQuietly()
  }

  async selectReasoningEffort(effort: string): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before changing reasoning effort')
    const preference = this.modelState.preferenceForEffort(effort)
    if (this.modelState.selectedReasoningEffort === effort) return
    await this.settings.set({ chatReasoningEffort: effort })
    this.modelState.apply(preference)
    this.emitEvent({ type: 'reasoningEffort', selectedReasoningEffort: effort })
    // Effort is part of the wire model name, so it takes effect with the next process.
    this.retireQuietly()
  }

  /** Close the live process without holding the caller; the next turn starts a fresh one. */
  private retireQuietly(): void {
    void this.session?.retire().catch((error: unknown) => {
      console.warn('[antigravity] could not retire the process:', error instanceof Error ? error.message : String(error))
    })
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
      chatContinuation: continuationFromThreadHandoff(this.paneId, source)
    })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
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
    if (this.settings.get().chatSeamlessRotation) {
      await this.rotateProviderSession()
      this.addNotice('Provider context will shrink on the next message; the visible transcript is unchanged.', 'info', null)
      return
    }
    const seed = buildCompactionSeed(this.transcript.snapshot(), this.threadName)
    if (!seed) throw new Error('There is no conversation to compact yet')
    const previous = this.session?.conversationId ?? null
    if (!this.session) this.session = this.createSession()
    await this.session.compact(seed)
    if (previous) this.bridge.unbind(previous)
    this.contextUsage = null
    await this.settings.set({ chatAntigravityConversationId: null })
    this.addNotice('Conversation context compacted; the next message continues from a summary.', 'info', null)
  }

  stop(): void {
    void this.session?.retire()
  }

  dispose(): void {
    this.transcript.stopBackgroundTasks('The Antigravity session ended before this task reported completion.')
    this.stop()
  }

  private async connect(warm: boolean): Promise<void> {
    this.setConnection({ state: 'starting', message: 'Starting Antigravity…' })
    try {
      // `agy models` is a process spawn that also proves sign-in. The workspace's last listing,
      // when it is recent, lets this pane be ready without one; a listing read here is shared.
      let cliModels = this.catalogs?.read<AntigravityCliModel[]>('antigravity', PROVIDER_CATALOG_TTL_MS)?.raw ?? null
      if (!cliModels) {
        const listing = await runAntigravityCommand(['models'])
        if (!listing.ok) throw new Error(listing.stderr.trim() || listing.stdout.trim() || `agy models exited with ${listing.code ?? 'a signal'}`)
        cliModels = parseAntigravityModelList(listing.stdout)
        if (cliModels.length === 0) throw new Error('agy models listed no models')
      }
      const saved = this.settings.get()
      this.modelState.load(antigravityModelCatalog(cliModels, saved.chatModelId, saved.chatReasoningEffort))
      this.catalogs?.remember('antigravity', this.modelState.models, cliModels)
      this.profile = await ensureAntigravityProfile(this.stateDir, { cwd: this.cwd })
      this.session ??= this.createSession()
      await resumePersistedAntigravityConversation(this.threadHost())
      this.account = { type: 'google', email: null, planType: null }
      this.setConnection({ state: 'ready', message: 'Antigravity is ready' })
      if (warm) await this.bridge.start()
      void this.refreshPlanUsage()
    } catch (error) {
      const message = messageOf(error)
      this.setConnection(isMissingExecutable(error)
        ? { state: 'unavailable', message: missingProviderMessage('antigravity') }
        : isAntigravityAuthFailure(message)
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
      onTokenUsage: (usage) => this.noteTokenUsage(usage),
      traceScope: () => ({ paneId: this.paneId, provider: 'antigravity', turnId: this.activeTurnId })
    })
  }

  private async resumeConversation(conversationId: string): Promise<void> {
    await resumeAntigravityConversation(this.threadHost(), conversationId)
  }

  private async detachThread(): Promise<void> {
    await detachAntigravityThread(this.threadHost())
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
    applyTranscriptOp(this.transcript, (text, tone) => this.addNotice(text, tone), op)
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
    if (end.status === 'failed' && this.retryWithoutUndeclaredTools(turnId, end.error ?? '')) return
    if (end.status === 'failed' && this.retryOnAuthFailure(turnId, end.error ?? '')) return
    handleProviderTurnEnd(turnId, end, {
      addNotice: (text, tone, id) => this.addNotice(text, tone, id),
      setPaused: (id) => this.setPaused(id)
    })
    this.persistTurn()
    if (end.status === 'completed') {
      const answer = this.transcript.snapshot()
        .flatMap((item) => item.type === 'assistant' && item.turnId === turnId ? [item.text] : [])
        .join('\n').trim()
      void this.updatePromptSuggestion(answer)
    }
  }

  /** Record the transcript as it stands, including a turn that ended in failure. */
  private persistTurn(): void {
    const conversationId = this.session?.conversationId
    if (!conversationId) return
    const items = this.transcript.snapshot()
    void Promise.all([this.history.saveTranscript(conversationId, items), this.history.recordThread(conversationId, this.cwd, items)])
      .catch((error: unknown) => { console.warn('[antigravity] could not record the conversation:', messageOf(error)) })
    void this.refreshThreadName(conversationId)
  }

  /** Test and turn-end seam; implementation lives in antigravity-turn-recovery.ts. */
  private retryOnAuthFailure(turnId: string, error: string): boolean {
    return retryAntigravityOnAuthFailure(this.turnRecoveryHost(), turnId, error)
  }

  private retryWithoutUndeclaredTools(turnId: string, error: string): boolean {
    return retryAntigravityWithoutUndeclaredTools(this.turnRecoveryHost(), turnId, error)
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
    if (turnId) {
      this.setPaused(null)
      this.suggestionGeneration += 1
      this.setPromptSuggestion(null)
      this.rotator.turnStarted()
    }
    this.bindBridge()
    this.emitEvent({ type: 'turn', turnId })
    if (turnId === null) {
      this.rotator.turnFinished()
      void this.refreshPlanUsage()
    }
  }

  private async rotateProviderSession(): Promise<void> {
    try {
      await rotateAntigravityProviderSession(this.threadHost())
    } finally {
      this.rotator.complete()
    }
  }

  private async updatePromptSuggestion(answer: string): Promise<void> {
    if (!answer) return
    const generation = ++this.suggestionGeneration
    const conversationId = this.session?.conversationId
    const model = antigravityWireModel(this.modelState.models, this.modelState.selectedModel, this.modelState.selectedReasoningEffort)
    const suggestion = await generatePromptSuggestion('antigravity', model, answer)
    if (this.activeTurnId || generation !== this.suggestionGeneration || this.session?.conversationId !== conversationId || !suggestion) return
    this.setPromptSuggestion(suggestion)
  }

  private setPromptSuggestion(suggestion: string | null): void {
    if (this.promptSuggestion === suggestion) return
    this.promptSuggestion = suggestion
    this.emitEvent({ type: 'promptSuggestion', suggestion })
  }

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
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

  private noteTokenUsage(usage: { inputTokens: number; cacheReadTokens?: number; cacheAnomaly: boolean }): void {
    if (usage.inputTokens <= 0) return
    const model = this.modelState.models.find((entry) => entry.id === this.modelState.selectedModel)
    const contextWindow = model?.contextWindow ?? antigravityContextWindow(this.modelState.selectedModel)
    this.contextUsage = { usedTokens: usage.inputTokens, contextWindow }
    this.rotator.noteUsage(this.contextUsage)
    this.emitEvent({ type: 'context', usage: describeUsage(this.contextUsage) })
  }

  private threadHost(): AntigravityThreadHost {
    return {
      settings: this.settings,
      paneId: this.paneId,
      history: this.history,
      cwd: this.cwd,
      bridge: this.bridge,
      transcript: this.transcript,
      rotator: this.rotator,
      session: () => this.session,
      setSession: (session) => { this.session = session },
      createSession: () => this.createSession(),
      threadName: () => this.threadName,
      setThreadName: (name) => { this.threadName = name },
      contextUsage: () => this.contextUsage,
      setContextUsage: (usage) => { this.contextUsage = usage },
      setActiveTurnId: (id) => { this.activeTurnId = id },
      snapshot: () => this.snapshot(),
      emitEvent: (event) => this.emitEvent(event),
      addNotice: (text, tone, turnId) => this.addNotice(text, tone, turnId)
    }
  }

  private turnRecoveryHost(): AntigravityTurnRecoveryHost {
    return {
      cwd: this.cwd,
      stateDir: this.stateDir,
      session: () => this.session,
      activeTurnId: () => this.activeTurnId,
      authRetrying: () => this.authRetrying,
      setAuthRetrying: (value) => { this.authRetrying = value },
      lastTurnContent: () => this.lastTurnContent,
      setProfile: (profile) => { this.profile = profile },
      setConnection: (connection) => this.setConnection(connection),
      addNotice: (text, tone, turnId) => this.addNotice(text, tone, turnId),
      persistTurn: () => this.persistTurn()
    }
  }
}
