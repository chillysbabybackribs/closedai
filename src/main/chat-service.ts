import { EventEmitter } from 'node:events'
import type {
  ChatAccount,
  ChatAttachment,
  ChatConnection,
  ChatEvent,
  ChatHistoryWindow,
  ChatModel,
  ChatPlanUsage,
  ChatSnapshot,
  ChatThreadContent,
  ChatThreadSummary
} from '../shared/chat.js'
import type { RotationSettingsAccess } from './chat-context/rotate-provider-session.js'
import {
  type AppServerNotification
} from './app-server-client.js'
import { answerServerRequest } from './chat-approvals.js'
import { messageOf, normalizeAccount, recordOf } from './chat-normalizers.js'
import { listWorkspaceThreads, startChatGptLogin } from './chat-requests.js'
import { routeChatNotification } from './chat-notification-router.js'
import { ChatTranscript } from './chat-transcript.js'
import {
  buildTurnAdditionalContext,
  type ActiveBrowserContext
} from './chat-context/turn-context.js'
import { resumeThreadParams } from './chat-context/thread-params.js'
import {
  detachThreadState,
  ensureCodexThread,
  readCachedThread,
  resumeCodexThread,
  resumePersistedCodexThread,
  rotateCodexProviderSession,
  threadModelSettings,
  type ChatServiceThreadHost
} from './chat-service-thread-lifecycle.js'
import { ContextCompactor, describeUsage, type ContextUsage } from './chat-context/context-compaction.js'
import { SessionRotator } from './chat-context/session-rotation.js'
import { codexPlanUsage } from './chat-context/plan-usage.js'
import {
  buildThreadHandoff,
  continuationFromThreadHandoff,
  handoffAdditionalContext,
  type ThreadHandoffSource
} from './chat-context/thread-handoff.js'
import { AppServerToolCalls } from './tools/app-server-tools.js'
import { ToolRegistry } from './tools/registry.js'
import { reasoningEffortForModel } from './chat-model-catalog.js'
import { ChatModelState } from './chat-model-state.js'
import { buildChatInput } from './chat-input.js'
import { shrinkPastedImages } from './chat-attachment-images.js'
import type { ScreenshotStore } from './tools/capture/screenshot-store.js'
import { traceLog } from './trace/trace-log.js'
import { CodexWorkspaceRuntime, type CodexRuntimeSession } from './codex-workspace-runtime.js'
import { MISSING_BINARY_RETRY_MS, isMissingExecutable, missingProviderMessage } from './provider-binary.js'

/** One pane's Codex state, backed by the workspace's shared app-server runtime. */
export class ChatService extends EventEmitter {
  private readonly client: CodexRuntimeSession
  private connection: ChatConnection = { state: 'starting', message: 'Starting Codex…' }
  private account: ChatAccount | null = null
  private readonly modelState = new ChatModelState()
  private threadId: string | null = null
  private threadName: string | null = null
  private threadToolCatalog: unknown = null
  private activeTurnId: string | null = null
  private pausedTurnId: string | null = null
  private planUsage: ChatPlanUsage | null = null
  private readonly transcript: ChatTranscript
  private readonly toolCalls: AppServerToolCalls
  private readonly compactor: ContextCompactor
  private readonly rotator: SessionRotator
  private startPromise: Promise<void> | null = null
  /**
   * Full reads of threads other than the live one: `readThread` asks the app-server to replay a
   * whole thread, and rotation prefetches its own source on every rotation, so an unbounded chat
   * re-paid that round trip on every hover and every rotation. The live thread is never served
   * from here — it can grow between calls — and an entry is dropped the moment its thread becomes
   * live, so a later read after it goes inactive again asks fresh rather than serving pre-live state.
   */
  private readonly threadCache = new Map<string, ChatThreadContent>()
  private resumePromise: Promise<void> | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private restartAttempt = 0
  private stopping = false

  constructor(
    readonly cwd: string,
    private readonly settings: RotationSettingsAccess,
    private readonly tools: ToolRegistry = new ToolRegistry([]),
    private readonly activeBrowserContext: () => ActiveBrowserContext | null = () => null,
    screenshots: Pick<ScreenshotStore, 'get'> | null = null,
    runtime: CodexWorkspaceRuntime,
    private readonly paneId: string | null = null
  ) {
    super()
    this.transcript = new ChatTranscript(
      cwd,
      () => this.activeTurnId,
      (event) => this.emitEvent(event),
      (callId) => screenshots?.get(callId) ?? null
    )
    this.client = runtime.session(
      this.paneId,
      () => this.threadId ?? this.settings.get().chatThreadId,
      () => this.activeTurnId
    )
    this.toolCalls = new AppServerToolCalls(this.tools, this.client, this.paneId)
    this.compactor = new ContextCompactor({
      thresholdPercent: () => this.settings.get().chatCompactAtPercent,
      thresholdTokens: () => this.settings.get().chatCompactAtTokens,
      threadId: () => this.threadId,
      turnActive: () => this.activeTurnId !== null,
      request: (method, params) => this.client.request(method, params),
      notice: (text, tone) => this.addNotice(text, tone, null)
    })
    this.rotator = new SessionRotator({
      enabled: () => this.seamlessRotation(),
      thresholdPercent: () => this.settings.get().chatCompactAtPercent,
      thresholdTokens: () => this.settings.get().chatCompactAtTokens,
      threadId: () => this.threadId,
      turnActive: () => this.activeTurnId !== null,
      rotate: () => rotateCodexProviderSession(this.threadHost())
    })
    this.client.on('notification', (notification: AppServerNotification) => this.onNotification(notification))
    this.client.on('request', (request) => {
      if (!this.toolCalls.handle(request)) answerServerRequest(this.client, request)
    })
    this.client.on('protocolError', (error: Error) => this.addNotice(error.message, 'error'))
    this.client.on('exit', () => this.onExit())
  }

  snapshot(window?: ChatHistoryWindow): ChatSnapshot {
    const page = window ? this.transcript.page(window) : null
    return {
      provider: 'codex',
      connection: { ...this.connection },
      account: this.account ? { ...this.account } : null,
      models: this.modelState.models,
      selectedModel: this.modelState.selectedModel,
      selectedReasoningEffort: this.modelState.selectedReasoningEffort,
      cwd: this.cwd,
      threadId: this.threadId,
      threadName: this.threadName,
      activeTurnId: this.activeTurnId,
      pausedTurnId: this.pausedTurnId,
      contextUsage: describeUsage(this.contextManager().current),
      planUsage: this.planUsage,
      items: page?.items ?? this.transcript.snapshot(),
      ...(page ? { history: { hasEarlier: page.hasEarlier, backgroundTasks: page.backgroundTasks } } : {})
    }
  }

  hasRunningBackground(): boolean {
    return this.transcript.hasRunningBackground()
  }

  async listModels(): Promise<ChatModel[]> {
    await this.ensureConnected()
    return this.modelState.models
  }

  /**
   * Read the account's plan windows. Cheap (one local app-server round trip) and safe while a
   * turn runs, so the hover card can ask for a fresh reading every time it opens.
   */
  async refreshPlanUsage(): Promise<void> {
    if (this.connection.state !== 'ready') return
    try {
      const response = await this.client.request<{ rateLimits?: unknown }>('account/rateLimits/read', {})
      this.notePlanUsage(codexPlanUsage(response.rateLimits))
    } catch (error) {
      console.warn('[app-server] could not read rate limits:', messageOf(error))
    }
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.stopping = false
    this.setConnection({ state: 'starting', message: 'Starting Codex…' })
    this.startPromise = this.connect().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  async send(text: string, attachments: ChatAttachment[] = [], prepare?: () => Promise<void>): Promise<void> {
    try {
      const { prompt, input, summaries } = buildChatInput(text, shrinkPastedImages(attachments))
      if (input.length === 0) return
      if (this.activeTurnId) throw new Error('A Codex turn is already running')
      const clientUserMessageId = crypto.randomUUID()
      // Paint the accepted message before a cold workspace runtime or fresh thread is ready.
      this.transcript.addOptimisticUser(clientUserMessageId, prompt, summaries)
      await prepare?.()
      const manager = this.contextManager()
      const endCompactionWait = manager.inFlight
        ? traceLog.responses.waitForCompaction(this.paneId) : () => {}
      await Promise.all([this.ensureReady(), manager.prepareForSend().finally(endCompactionWait)])
      if (this.activeTurnId) throw new Error('A Codex turn is already running')
      const threadId = await this.ensureThread(clientUserMessageId)
      const pendingHandoff = this.settings.get().chatContinuation?.handoff ?? null
      const additionalContext = {
        ...this.turnAdditionalContext(prompt),
        ...(pendingHandoff ? handoffAdditionalContext(pendingHandoff) : {})
      }
      if (this.threadId !== threadId || this.activeTurnId || this.stopping) throw new Error('Codex conversation changed while preparing the turn')
      const response = await this.client.request<{ turn?: unknown }>('turn/start', {
        threadId,
        clientUserMessageId,
        ...(this.modelState.selectedModel ? { model: this.modelState.selectedModel } : {}),
        ...(this.modelState.selectedReasoningEffort ? { effort: this.modelState.selectedReasoningEffort } : {}),
        ...(Object.keys(additionalContext).length ? { additionalContext } : {}),
        input
      })
      await this.clearDeliveredHandoff()
      const turn = recordOf(response.turn)
      if (typeof turn?.id === 'string') this.setTurn(turn.id)
    } catch (error) {
      this.addNotice(messageOf(error), 'error')
      throw error
    }
  }

  async interrupt(): Promise<void> {
    if (!this.threadId || !this.activeTurnId) return
    const turnId = this.activeTurnId
    try {
      await this.client.request('turn/interrupt', { threadId: this.threadId, turnId })
    } catch (error) {
      this.addNotice(`Could not stop the turn: ${messageOf(error)}`, 'error')
      throw error
    }
  }

  async selectModel(modelId: string): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before changing models')
    const preference = this.modelState.preferenceForModel(modelId)
    if (this.modelState.selectedModel === modelId && this.modelState.selectedReasoningEffort === preference.effort) return
    if (this.threadId) {
      await this.client.request('thread/resume', {
        ...resumeThreadParams(
          this.threadId,
          this.cwd,
          this.tools,
          threadModelSettings(this.threadHost(), preference.model, preference.effort)
        ),
        excludeTurns: true
      })
    }
    await this.settings.set({ chatModelId: modelId, chatReasoningEffort: preference.effort })
    this.modelState.apply(preference)
    this.emitEvent({ type: 'model', selectedModel: modelId, selectedReasoningEffort: preference.effort })
  }

  async selectReasoningEffort(effort: string): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before changing reasoning effort')
    const preference = this.modelState.preferenceForEffort(effort)
    if (this.modelState.selectedReasoningEffort === effort) return
    await this.settings.set({ chatReasoningEffort: effort })
    this.modelState.apply(preference)
    this.emitEvent({ type: 'reasoningEffort', selectedReasoningEffort: effort })
  }

  async listThreads(): Promise<ChatThreadSummary[]> {
    return listWorkspaceThreads(this.client, this.cwd)
  }

  async readThread(threadId: string): Promise<ChatThreadContent> {
    return readCachedThread(this.threadHost(), threadId)
  }

  /** Clear the pane. The next `send` lazily starts a fresh app-server thread. */
  async newThread(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before starting a new chat')
    if (!this.threadId && this.transcript.isEmpty && !this.settings.get().chatContinuation) return
    detachThreadState(this.threadHost())
    await this.settings.set({ chatThreadId: null, chatContinuation: null })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  /**
   * Leave this chat behind and start the next message in a fresh thread that carries only a
   * digest of it. The old thread stays in history; the new one skips its replayed tool output.
   */
  async continueInNewThread(from?: ThreadHandoffSource): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before continuing in a new chat')
    const source = from ?? this.ownHandoff()
    if (!source) throw new Error('There is no conversation to continue yet')
    detachThreadState(this.threadHost())
    await this.settings.set({
      chatThreadId: null,
      chatContinuation: continuationFromThreadHandoff(this.paneId, source)
    })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  /** This thread as the digest its successor carries, or null when there is nothing to carry. */
  private ownHandoff(): ThreadHandoffSource | null {
    const handoff = buildThreadHandoff(this.transcript.snapshot(), this.threadName)
    return handoff ? { ...handoff, provider: 'codex', threadId: this.threadId } : null
  }

  async openThread(threadId: string): Promise<void> {
    if (!threadId) throw new Error('Invalid thread')
    if (threadId === this.threadId) return
    if (this.activeTurnId) throw new Error('Stop the current turn before switching chats')
    await this.ensureReady()
    try {
      await this.resumeThread(threadId)
    } catch (error) {
      this.addNotice(`Could not open that chat: ${messageOf(error)}`, 'error')
      throw error
    }
  }

  async archiveThread(threadId: string): Promise<void> {
    if (!threadId) throw new Error('Invalid thread')
    if (threadId === this.threadId && this.activeTurnId) throw new Error('Stop the current turn before archiving this chat')
    await this.ensureConnected()
    await this.client.request('thread/archive', { threadId })
    if (threadId === this.threadId) await this.newThread()
  }

  async beginChatGptLogin(): Promise<string> {
    await this.ensureConnected()
    return startChatGptLogin(this.client)
  }

  stop(): void {
    // A parked or provider-switched pane releases no process: Codex is workspace-owned now.
    // Its scoped listener stays registered so returning to the pane needs no reconnect path.
  }

  dispose(): void {
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.client.stop()
  }

  private async connect(): Promise<void> {
    try {
      await this.client.start()
      await this.refreshAccountAndModels(false)
      if (this.connection.state === 'ready') await this.resumePersistedThread()
      void this.refreshPlanUsage()
      this.restartAttempt = 0
    } catch (error) {
      // A missing binary is an onboarding state, not a fault: say what to install and re-probe
      // slowly, so the loop still recovers once `codex` appears without hammering every 15 s.
      const missing = isMissingExecutable(error)
      this.setConnection({ state: 'unavailable', message: missing ? missingProviderMessage('codex') : messageOf(error) })
      this.scheduleRestart(missing ? MISSING_BINARY_RETRY_MS : null)
    }
  }

  private async refreshAccountAndModels(refresh: boolean): Promise<void> {
    const session = await this.client.readSession(refresh)
    this.account = normalizeAccount(session.account)
    const saved = this.settings.get()
    const selectedModel = session.models.some((model) => model.id === saved.chatModelId)
      ? saved.chatModelId
      : session.models.find((model) => model.isDefault)?.id ?? session.models[0]?.id ?? null
    this.modelState.load({
      models: session.models,
      selectedModel,
      selectedReasoningEffort: reasoningEffortForModel(
        session.models,
        selectedModel,
        saved.chatReasoningEffort
      )
    })
    const requiresOpenaiAuth = session.requiresOpenaiAuth
    if (!this.account && requiresOpenaiAuth) {
      this.setConnection({ state: 'signed-out', message: 'Sign in to use Codex' })
    } else {
      this.setConnection({ state: 'ready', message: 'Codex is ready' })
    }
  }

  private resumePersistedThread(): Promise<void> {
    if (this.resumePromise) return this.resumePromise
    this.resumePromise = this.doResumePersistedThread().finally(() => {
      this.resumePromise = null
    })
    return this.resumePromise
  }

  private async doResumePersistedThread(): Promise<void> {
    await resumePersistedCodexThread(this.threadHost())
  }

  /** Load a thread's history from the app-server and make it the active one. */
  private async resumeThread(threadId: string): Promise<void> {
    await resumeCodexThread(this.threadHost(), threadId)
  }

  private seamlessRotation(): boolean {
    return this.settings.get().chatSeamlessRotation === true
  }

  private contextManager(): ContextCompactor | SessionRotator {
    return this.seamlessRotation() ? this.rotator : this.compactor
  }

  private async ensureReady(): Promise<void> {
    await this.ensureConnected()
    if (this.connection.state === 'signed-out') throw new Error('Sign in to ChatGPT before sending a message')
    if (this.connection.state !== 'ready') throw new Error(this.connection.message)
  }

  private async clearDeliveredHandoff(): Promise<void> {
    const continuation = this.settings.get().chatContinuation
    if (continuation?.handoff) await this.settings.set({ chatContinuation: { ...continuation, handoff: null } })
  }

  private async ensureConnected(): Promise<void> {
    if (this.connection.state === 'ready' || this.connection.state === 'signed-out') return
    await this.start()
  }

  private async ensureThread(clientUserMessageId?: string): Promise<string> {
    return ensureCodexThread(this.threadHost(), clientUserMessageId)
  }

  private threadHost(): ChatServiceThreadHost {
    return {
      cwd: this.cwd,
      client: this.client,
      tools: this.tools,
      settings: this.settings,
      paneId: this.paneId,
      threadId: () => this.threadId,
      threadName: () => this.threadName,
      threadToolCatalog: () => this.threadToolCatalog,
      transcript: this.transcript,
      compactor: this.compactor,
      rotator: this.rotator,
      modelState: this.modelState,
      threadCache: this.threadCache,
      ensureConnected: () => this.ensureConnected(),
      contextManager: () => this.contextManager(),
      snapshot: () => this.snapshot(),
      emitEvent: (event) => this.emitEvent(event),
      setThreadId: (id) => { this.threadId = id },
      setThreadName: (name) => { this.threadName = name },
      setThreadToolCatalog: (catalog) => { this.threadToolCatalog = catalog },
      setActiveTurnId: (id) => { this.activeTurnId = id }
    }
  }

  /** Context is optional enrichment: stale UI state must never prevent a send. */
  private turnAdditionalContext(prompt: string): ReturnType<typeof buildTurnAdditionalContext> {
    try {
      return buildTurnAdditionalContext(prompt, this.activeBrowserContext())
    } catch (error) {
      console.warn('[chat-context] could not capture active browser state:', messageOf(error))
      return undefined
    }
  }

  private onNotification(notification: AppServerNotification): void {
    routeChatNotification(notification, {
      activeThreadId: () => this.threadId,
      activeTurnId: () => this.activeTurnId,
      setThreadName: (name) => { this.threadName = name },
      setTurn: (turnId) => this.setTurn(turnId),
      setPaused: (turnId) => this.setPaused(turnId),
      consumeItem: (item, turnId, completed) => this.transcript.consume(item, turnId, completed),
      appendDelta: (itemId, field, delta) => this.transcript.appendDelta(itemId, field, delta),
      addNotice: (text, tone, turnId) => this.addNotice(text, tone, turnId),
      refreshSession: () => this.refreshSession(),
      noteContextUsage: (usage) => this.noteContextUsage(usage),
      notePlanUsage: (snapshot) => this.notePlanUsage(codexPlanUsage(snapshot)),
      contextCompacted: () => this.compactor.compacted(),
      emit: (event) => this.emitEvent(event)
    })
  }

  private refreshSession(): void {
    void this.refreshAccountAndModels(true)
      .then(() => this.connection.state === 'ready' ? this.resumePersistedThread() : undefined)
      .catch((error) => this.setConnection({ state: 'error', message: messageOf(error) }))
  }

  private addNotice(text: string, tone: 'info' | 'error', turnId: string | null = this.activeTurnId): void {
    this.transcript.addNotice(text, tone, turnId)
  }

  private setConnection(connection: ChatConnection): void {
    this.connection = connection
    this.emitEvent({
      type: 'connection',
      provider: 'codex',
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
      this.contextManager().turnStarted()
    }
    this.emitEvent({ type: 'turn', turnId })
    if (turnId === null) {
      this.contextManager().turnFinished()
      void this.refreshPlanUsage()
    }
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

  private noteContextUsage(usage: ContextUsage): void {
    this.contextManager().noteUsage(usage)
    this.emitEvent({ type: 'context', usage: describeUsage(usage) })
  }

  private notePlanUsage(usage: ChatPlanUsage | null): void {
    if (!usage) return
    this.planUsage = usage
    this.emitEvent({ type: 'planUsage', usage })
  }

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
  }

  private onExit(): void {
    this.compactor.reset()
    this.rotator.reset()
    this.setTurn(null)
    this.setConnection({ state: 'error', message: 'Codex stopped unexpectedly; reconnecting…' })
    this.scheduleRestart()
  }

  private scheduleRestart(fixedDelay: number | null = null): void {
    if (this.stopping || this.restartTimer) return
    const delay = fixedDelay ?? Math.min(1_000 * 2 ** this.restartAttempt, 15_000)
    this.restartAttempt += 1
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.start()
    }, delay)
  }
}
