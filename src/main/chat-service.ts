import { EventEmitter } from 'node:events'
import type {
  ChatAccount,
  ChatAttachment,
  ChatConnection,
  ChatEvent,
  ChatModel,
  ChatSnapshot,
  ChatThreadSummary
} from '../shared/chat.js'
import type { AppSettingsStore } from './app-settings-store.js'
import {
  AppServerClient,
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
import { resumeThreadParams, startThreadParams } from './chat-context/thread-params.js'
import { ContextCompactor, describeUsage, type ContextUsage } from './chat-context/context-compaction.js'
import { appServerConfigArgs } from './chat-context/app-server-config.js'
import { buildThreadHandoff, handoffAdditionalContext } from './chat-context/thread-handoff.js'
import { AppServerToolCalls } from './tools/app-server-tools.js'
import { ToolRegistry } from './tools/registry.js'
import { loadChatModels } from './chat-model-catalog.js'
import { buildChatInput } from './chat-input.js'
import { shrinkPastedImages } from './chat-attachment-images.js'
import type { ScreenshotStore } from './tools/capture/screenshot-store.js'

type ThreadResponse = {
  thread?: unknown
  model?: unknown
}

const DEFAULT_CONNECTION: ChatConnection = {
  state: 'starting',
  message: 'Starting Codex…'
}

export class ChatService extends EventEmitter {
  private readonly client: AppServerClient
  private connection: ChatConnection = DEFAULT_CONNECTION
  private account: ChatAccount | null = null
  private models: ChatModel[] = []
  private selectedModel: string | null = null
  private threadId: string | null = null
  private threadName: string | null = null
  private activeTurnId: string | null = null
  private readonly transcript: ChatTranscript
  private readonly toolCalls: AppServerToolCalls
  private readonly compactor: ContextCompactor
  /** Digest of the chat the user chose to continue from; rides on the next turn, once. */
  private pendingHandoff: string | null = null
  private startPromise: Promise<void> | null = null
  private resumePromise: Promise<void> | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private restartAttempt = 0
  private stopping = false

  constructor(
    readonly cwd: string,
    private readonly settings: AppSettingsStore,
    private readonly tools: ToolRegistry = new ToolRegistry([]),
    private readonly activeBrowserContext: () => ActiveBrowserContext | null = () => null,
    screenshots: Pick<ScreenshotStore, 'get'> | null = null,
    executable = process.env.CLOSEDAI_CODEX_PATH?.trim() || 'codex'
  ) {
    super()
    this.transcript = new ChatTranscript(
      cwd,
      () => this.activeTurnId,
      (event) => this.emitEvent(event),
      (callId) => screenshots?.get(callId) ?? null
    )
    this.client = new AppServerClient(executable, cwd, () => appServerConfigArgs(this.settings.get()))
    this.toolCalls = new AppServerToolCalls(this.tools, this.client)
    this.compactor = new ContextCompactor({
      thresholdPercent: () => this.settings.get().chatCompactAtPercent,
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

  snapshot(): ChatSnapshot {
    return {
      connection: { ...this.connection },
      account: this.account ? { ...this.account } : null,
      models: this.models.map((model) => ({ ...model })),
      selectedModel: this.selectedModel,
      cwd: this.cwd,
      threadId: this.threadId,
      threadName: this.threadName,
      activeTurnId: this.activeTurnId,
      contextUsage: describeUsage(this.compactor.current),
      items: this.transcript.snapshot()
    }
  }

  async listModels(): Promise<ChatModel[]> {
    await this.ensureConnected()
    return this.models.map((model) => ({ ...model }))
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
      await this.ensureReady()
      await this.compactor.idle()
      if (this.activeTurnId) throw new Error('A Codex turn is already running')
      const threadId = await this.ensureThread()
      const clientUserMessageId = crypto.randomUUID()
      const additionalContext = {
        ...this.turnAdditionalContext(prompt),
        ...(this.pendingHandoff ? handoffAdditionalContext(this.pendingHandoff) : {})
      }
      this.transcript.addOptimisticUser(clientUserMessageId, prompt, summaries)
      const response = await this.client.request<{ turn?: unknown }>('turn/start', {
        threadId,
        clientUserMessageId,
        ...(this.selectedModel ? { model: this.selectedModel } : {}),
        ...(Object.keys(additionalContext).length ? { additionalContext } : {}),
        input
      })
      this.pendingHandoff = null
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
    if (!this.models.some((model) => model.id === modelId)) throw new Error('That Codex model is not available')
    if (this.selectedModel === modelId) return
    await this.settings.set({ chatModelId: modelId })
    this.selectedModel = modelId
    this.emitEvent({ type: 'model', selectedModel: modelId })
  }

  async listThreads(): Promise<ChatThreadSummary[]> {
    await this.ensureConnected()
    return listWorkspaceThreads(this.client, this.cwd)
  }

  /** Clear the pane. The next `send` lazily starts a fresh app-server thread. */
  async newThread(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before starting a new chat')
    if (!this.threadId && this.transcript.isEmpty) return
    this.detachThread()
    await this.settings.set({ chatThreadId: null })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  /**
   * Leave this chat behind and start the next message in a fresh thread that carries only a
   * digest of it. The old thread stays in history; the new one skips its replayed tool output.
   */
  async continueInNewThread(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before continuing in a new chat')
    const handoff = buildThreadHandoff(this.transcript.snapshot(), this.threadName)
    if (!handoff) throw new Error('There is no conversation to continue yet')
    this.detachThread()
    this.pendingHandoff = handoff.text
    await this.settings.set({ chatThreadId: null })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
    this.addNotice(`Continuing from “${handoff.title}”. A short summary of that chat goes with your next message.`, 'info', null)
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
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.client.stop()
  }

  private async connect(): Promise<void> {
    try {
      await this.client.start()
      await this.refreshAccountAndModels()
      if (this.connection.state === 'ready') await this.resumePersistedThread()
      this.restartAttempt = 0
    } catch (error) {
      this.setConnection({ state: 'unavailable', message: messageOf(error) })
      this.scheduleRestart()
    }
  }

  private async refreshAccountAndModels(): Promise<void> {
    const accountResponse = await this.client.request<{ account?: unknown; requiresOpenaiAuth?: unknown }>(
      'account/read',
      { refreshToken: false }
    )
    this.account = normalizeAccount(accountResponse.account)
    try {
      const catalog = await loadChatModels(this.client, this.settings.get().chatModelId)
      this.models = catalog.models
      this.selectedModel = catalog.selectedModel
    } catch (error) {
      console.warn('[app-server] could not list models:', messageOf(error))
      this.models = []
      this.selectedModel = null
    }
    const requiresOpenaiAuth = accountResponse.requiresOpenaiAuth === true
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
      resumeThreadParams(threadId, this.cwd, this.tools)
    )
    const thread = recordOf(response.thread)
    if (typeof thread?.id !== 'string') throw new Error('Codex returned an invalid thread')
    this.threadId = thread.id
    this.threadName = nullableString(thread.name)
    this.adoptThreadModel(response.model)
    this.transcript.replaceFromThread(thread)
    this.compactor.reset()
    await this.settings.set({ chatThreadId: thread.id })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  /** Forget the active thread and its transcript without touching persisted settings. */
  private detachThread(): void {
    this.threadId = null
    this.threadName = null
    this.transcript.clear()
    this.compactor.reset()
    this.pendingHandoff = null
    this.activeTurnId = null
  }

  private async ensureReady(): Promise<void> {
    await this.ensureConnected()
    if (this.connection.state === 'signed-out') throw new Error('Sign in to ChatGPT before sending a message')
    if (this.connection.state !== 'ready') throw new Error(this.connection.message)
  }

  private async ensureConnected(): Promise<void> {
    if (this.connection.state === 'ready' || this.connection.state === 'signed-out') return
    await this.start()
  }

  private async ensureThread(): Promise<string> {
    if (this.threadId) return this.threadId
    const response = await this.client.request<ThreadResponse>(
      'thread/start',
      startThreadParams(this.cwd, this.tools, this.selectedModel)
    )
    const thread = recordOf(response.thread)
    if (typeof thread?.id !== 'string') throw new Error('Codex returned an invalid thread')
    this.threadId = thread.id
    this.threadName = nullableString(thread.name)
    this.adoptThreadModel(response.model)
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
      consumeItem: (item, turnId, completed) => this.transcript.consume(item, turnId, completed),
      appendDelta: (itemId, field, delta) => this.transcript.appendDelta(itemId, field, delta),
      addNotice: (text, tone, turnId) => this.addNotice(text, tone, turnId),
      refreshSession: () => this.refreshSession(),
      noteContextUsage: (usage) => this.noteContextUsage(usage),
      contextCompacted: () => this.compactor.compacted(),
      emit: (event) => this.emitEvent(event)
    })
  }

  private refreshSession(): void {
    void this.refreshAccountAndModels()
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
      connection: { ...connection },
      account: this.account ? { ...this.account } : null,
      models: this.models.map((model) => ({ ...model })),
      selectedModel: this.selectedModel
    })
  }

  private setTurn(turnId: string | null): void {
    if (this.activeTurnId === turnId) return
    this.activeTurnId = turnId
    this.emitEvent({ type: 'turn', turnId })
    if (turnId === null) this.compactor.turnFinished()
  }

  private noteContextUsage(usage: ContextUsage): void {
    this.compactor.noteUsage(usage)
    this.emitEvent({ type: 'context', usage: describeUsage(usage) })
  }

  private adoptThreadModel(value: unknown): void {
    if (typeof value !== 'string' || !this.models.some((model) => model.id === value)) return
    this.selectedModel = value
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
