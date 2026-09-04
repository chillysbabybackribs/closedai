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
  ChatThreadSummary,
  ChatTurnContextReport
} from '../shared/chat.js'
import type { AppSettingsAccess } from './app-settings-store.js'
import {
  type AppServerNotification
} from './app-server-client.js'
import { answerServerRequest } from './chat-approvals.js'
import { messageOf, normalizeAccount, nullableString, recordOf } from './chat-normalizers.js'
import { listWorkspaceThreads, startChatGptLogin } from './chat-requests.js'
import { routeChatNotification } from './chat-notification-router.js'
import { ChatTranscript } from './chat-transcript.js'
import {
  buildTurnAdditionalContext,
  type ActiveBrowserContext
} from './chat-context/turn-context.js'
import { resumeThreadParams, startThreadParams, type ThreadResponse } from './chat-context/thread-params.js'
import { ContextCompactor, describeUsage, type ContextUsage } from './chat-context/context-compaction.js'
import { codexPlanUsage } from './chat-context/plan-usage.js'
import { buildThreadHandoff, handoffAdditionalContext, type ThreadHandoffSource } from './chat-context/thread-handoff.js'
import { buildTurnContextReport } from './chat-context/turn-inspector.js'
import { AppServerToolCalls } from './tools/app-server-tools.js'
import { ToolRegistry } from './tools/registry.js'
import { reasoningEffortForModel } from './chat-model-catalog.js'
import { ChatModelState } from './chat-model-state.js'
import { buildChatInput } from './chat-input.js'
import { shrinkPastedImages } from './chat-attachment-images.js'
import type { ScreenshotStore } from './tools/capture/screenshot-store.js'
import { traceLog } from './trace/trace-log.js'
import { CodexWorkspaceRuntime, type CodexRuntimeSession } from './codex-workspace-runtime.js'

/** One pane's Codex state, backed by the workspace's shared app-server runtime. */
export class ChatService extends EventEmitter {
  private readonly client: CodexRuntimeSession
  private connection: ChatConnection = { state: 'starting', message: 'Starting Codex…' }
  private account: ChatAccount | null = null
  private readonly modelState = new ChatModelState()
  private threadId: string | null = null
  private threadName: string | null = null
  private activeTurnId: string | null = null
  private pausedTurnId: string | null = null
  private turnContext: ChatTurnContextReport | null = null
  private planUsage: ChatPlanUsage | null = null
  private readonly transcript: ChatTranscript
  private readonly toolCalls: AppServerToolCalls
  private readonly compactor: ContextCompactor
  private startPromise: Promise<void> | null = null
  private resumePromise: Promise<void> | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private restartAttempt = 0
  private stopping = false

  constructor(
    readonly cwd: string,
    private readonly settings: AppSettingsAccess,
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
      contextUsage: describeUsage(this.compactor.current),
      planUsage: this.planUsage,
      turnContext: this.turnContext,
      items: page?.items ?? this.transcript.snapshot(),
      ...(page ? { history: { hasEarlier: page.hasEarlier, backgroundTasks: page.backgroundTasks } } : {})
    }
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

  async send(text: string, attachments: ChatAttachment[] = []): Promise<void> {
    try {
      const { prompt, input, summaries } = buildChatInput(text, shrinkPastedImages(attachments))
      if (input.length === 0) return
      if (this.activeTurnId) throw new Error('A Codex turn is already running')
      const clientUserMessageId = crypto.randomUUID()
      // Paint the accepted message before a cold workspace runtime or fresh thread is ready.
      this.transcript.addOptimisticUser(clientUserMessageId, prompt, summaries)
      const endCompactionWait = this.compactor.inFlight
        ? traceLog.responses.waitForCompaction(this.paneId) : () => {}
      await Promise.all([this.ensureReady(), this.compactor.prepareForSend().finally(endCompactionWait)])
      if (this.activeTurnId) throw new Error('A Codex turn is already running')
      const threadId = await this.ensureThread()
      const pendingHandoff = this.settings.get().chatContinuation?.handoff ?? null
      const additionalContext = {
        ...this.turnAdditionalContext(prompt),
        ...(pendingHandoff ? handoffAdditionalContext(pendingHandoff) : {})
      }
      const response = await this.client.request<{ turn?: unknown }>('turn/start', {
        threadId,
        clientUserMessageId,
        ...(this.modelState.selectedModel ? { model: this.modelState.selectedModel } : {}),
        ...(this.modelState.selectedReasoningEffort ? { effort: this.modelState.selectedReasoningEffort } : {}),
        ...(Object.keys(additionalContext).length ? { additionalContext } : {}),
        input
      })
      this.turnContext = buildTurnContextReport({
        provider: 'codex', model: this.modelState.selectedModel, threadId, prompt,
        attachments: summaries, additionalContext
      })
      this.emitEvent({ type: 'turnContext', report: this.turnContext })
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
    await this.ensureConnected()
    const response = await this.client.request<ThreadResponse>('thread/read', { threadId, includeTurns: true })
    const thread = recordOf(response.thread)
    if (typeof thread?.id !== 'string') throw new Error('Codex returned an invalid thread')
    const replay = new ChatTranscript(this.cwd, () => null, () => undefined)
    replay.replaceFromThread(thread)
    return { threadId: thread.id, threadName: nullableString(thread.name), items: replay.snapshot() }
  }

  /** Clear the pane. The next `send` lazily starts a fresh app-server thread. */
  async newThread(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before starting a new chat')
    if (!this.threadId && this.transcript.isEmpty && !this.settings.get().chatContinuation) return
    this.detachThread()
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
    this.detachThread()
    await this.settings.set({
      chatThreadId: null,
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
      this.setConnection({ state: 'unavailable', message: messageOf(error) })
      this.scheduleRestart()
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
    if (this.threadId) return
    const persisted = this.settings.get().chatThreadId
    if (!persisted) return
    try {
      await this.resumeThread(persisted)
    } catch (error) {
      console.warn('[app-server] could not resume saved thread:', messageOf(error))
      this.detachThread()
      await this.settings.set({ chatThreadId: null })
      this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
    }
  }

  /** Load a thread's history from the app-server and make it the active one. */
  private async resumeThread(threadId: string): Promise<void> {
    const response = await this.client.request<ThreadResponse>(
      'thread/resume',
      resumeThreadParams(threadId, this.cwd, this.tools, this.modelState.selectedReasoningEffort)
    )
    const thread = recordOf(response.thread)
    if (typeof thread?.id !== 'string') throw new Error('Codex returned an invalid thread')
    this.threadId = thread.id
    this.threadName = nullableString(thread.name)
    const saved = this.settings.get()
    this.modelState.adoptResumed(
      { model: saved.chatModelId, effort: saved.chatReasoningEffort },
      { model: response.model, effort: response.reasoningEffort }
    )
    this.transcript.replaceFromThread(thread)
    this.compactor.reset()
    await this.settings.set({ chatThreadId: thread.id, chatContinuation: null })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  /** Forget the active thread and its transcript without touching persisted settings. */
  private detachThread(): void {
    this.threadId = null
    this.threadName = null
    this.transcript.clear()
    this.compactor.reset()
    this.activeTurnId = null
    this.turnContext = null
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

  private async ensureThread(): Promise<string> {
    if (this.threadId) return this.threadId
    const response = await this.client.request<ThreadResponse>(
      'thread/start',
      startThreadParams(this.cwd, this.tools, this.modelState.selectedModel, this.modelState.selectedReasoningEffort)
    )
    const thread = recordOf(response.thread)
    if (typeof thread?.id !== 'string') throw new Error('Codex returned an invalid thread')
    this.threadId = thread.id
    this.threadName = nullableString(thread.name)
    this.modelState.adopt(response.model)
    await this.settings.set({ chatThreadId: thread.id })
    this.emitEvent({ type: 'thread', threadId: thread.id, threadName: this.threadName })
    return thread.id
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
      this.compactor.turnStarted()
    }
    this.emitEvent({ type: 'turn', turnId })
    if (turnId === null) {
      this.compactor.turnFinished()
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
    this.compactor.noteUsage(usage)
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
    this.setTurn(null)
    this.setConnection({ state: 'error', message: 'Codex stopped unexpectedly; reconnecting…' })
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return
    const delay = Math.min(1_000 * 2 ** this.restartAttempt, 15_000)
    this.restartAttempt += 1
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.start()
    }, delay)
  }
}
