import { EventEmitter } from 'node:events'
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import type {
  ChatAccount,
  ChatAttachment,
  ChatConnection,
  ChatEvent,
  ChatSnapshot,
  ChatThreadSummary
} from '../../shared/chat.js'
import type { AppSettingsStore } from '../app-settings-store.js'
import { shrinkPastedImages } from '../chat-attachment-images.js'
import { describeUsage, type ContextUsage } from '../chat-context/context-compaction.js'
import { buildThreadHandoff, handoffAdditionalContext } from '../chat-context/thread-handoff.js'
import { buildTurnAdditionalContext, type ActiveBrowserContext } from '../chat-context/turn-context.js'
import { ChatModelState } from '../chat-model-state.js'
import { messageOf } from '../chat-normalizers.js'
import { ChatTranscript } from '../chat-transcript.js'
import type { ScreenshotStore } from '../tools/capture/screenshot-store.js'
import { ToolRegistry } from '../tools/registry.js'
import { archiveClaudeThread, claudeThreadName, listClaudeThreads, replayClaudeSession } from './claude-history.js'
import { claudeModelValue, claudeSessionIdOf, claudeThreadId } from './claude-ids.js'
import { buildClaudeUserMessage } from './claude-input.js'
import { claudeSystemPromptAppend } from './claude-instructions.js'
import { claudeModelCatalog, supportsAdaptiveThinking } from './claude-models.js'
import { loadClaudeSdk, type ClaudeSdk } from './claude-sdk.js'
import { ClaudeSession } from './claude-session.js'
import type { TranscriptOp, TurnEnd } from './claude-stream.js'
import { claudeMcpServers } from './claude-tools.js'

// The Claude Code provider, mirroring ChatService's surface so the hub can route to either.
// Everything model-facing is the Claude Agent SDK: the process, the tools (as in-process MCP
// servers over the shared registry), the session store that is also the chat history.

const SIGN_IN_MESSAGE = 'Sign in to Claude Code: run `claude` in a terminal, complete /login, then choose a Claude model again.'

export class ClaudeChatService extends EventEmitter {
  private sdk: ClaudeSdk | null = null
  private session: ClaudeSession | null = null
  private connection: ChatConnection = { state: 'starting', message: 'Starting Claude Code…' }
  private account: ChatAccount | null = null
  private readonly modelState = new ChatModelState()
  private modelInfos: ModelInfo[] = []
  private threadName: string | null = null
  private activeTurnId: string | null = null
  private contextUsage: ContextUsage | null = null
  private pendingHandoff: string | null = null
  private readonly transcript: ChatTranscript
  private startPromise: Promise<void> | null = null

  constructor(
    readonly cwd: string,
    private readonly settings: AppSettingsStore,
    private readonly tools: ToolRegistry = new ToolRegistry([]),
    private readonly activeBrowserContext: () => ActiveBrowserContext | null = () => null,
    private readonly screenshots: Pick<ScreenshotStore, 'get'> | null = null
  ) {
    super()
    this.transcript = new ChatTranscript(cwd, () => this.activeTurnId, (event) => this.emitEvent(event), (callId) => screenshots?.get(callId) ?? null)
  }

  snapshot(): ChatSnapshot {
    return {
      provider: 'claude',
      connection: { ...this.connection },
      account: this.account ? { ...this.account } : null,
      models: this.modelState.models.map((model) => ({ ...model })),
      selectedModel: this.modelState.selectedModel,
      selectedReasoningEffort: this.modelState.selectedReasoningEffort,
      cwd: this.cwd,
      threadId: this.session?.sessionId ? claudeThreadId(this.session.sessionId) : null,
      threadName: this.threadName,
      activeTurnId: this.activeTurnId,
      contextUsage: describeUsage(this.contextUsage),
      items: this.transcript.snapshot()
    }
  }

  /** Load the SDK, read the catalog and account, and resume the saved session's transcript. */
  start(options: { warm?: boolean } = {}): Promise<void> {
    this.startPromise ??= this.connect(options.warm === true).finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async send(text: string, attachments: ChatAttachment[] = []): Promise<void> {
    try {
      await this.ensureReady()
      const session = this.session!
      if (this.activeTurnId) throw new Error('A Claude turn is already running')
      const context = {
        ...this.turnAdditionalContext(text),
        ...(this.pendingHandoff ? handoffAdditionalContext(this.pendingHandoff) : {})
      }
      const turn = await buildClaudeUserMessage(text, shrinkPastedImages(attachments), Object.keys(context).length ? context : undefined, session.sessionId)
      if (!turn) return
      this.transcript.addOptimisticUser(crypto.randomUUID(), turn.prompt, turn.summaries)
      session.send(turn.message)
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
    await this.applyModelPreference()
    this.emitEvent({ type: 'model', selectedModel: modelId, selectedReasoningEffort: preference.effort })
  }

  async selectReasoningEffort(effort: string): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before changing reasoning effort')
    const preference = this.modelState.preferenceForEffort(effort)
    if (this.modelState.selectedReasoningEffort === effort) return
    await this.settings.set({ chatReasoningEffort: effort })
    this.modelState.apply(preference)
    await this.session?.setEffort(effort)
    this.emitEvent({ type: 'reasoningEffort', selectedReasoningEffort: effort })
  }

  async listThreads(): Promise<ChatThreadSummary[]> {
    await this.ensureConnected()
    return listClaudeThreads(this.sdk!, this.cwd)
  }

  /** Clear the pane; the next message starts a fresh SDK session. */
  async newThread(): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before starting a new chat')
    if (!this.session?.sessionId && this.transcript.isEmpty) return
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
    const sessionId = claudeSessionIdOf(threadId)
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
    const sessionId = claudeSessionIdOf(threadId)
    if (!sessionId) throw new Error('Invalid thread')
    if (sessionId === this.session?.sessionId && this.activeTurnId) throw new Error('Stop the current turn before archiving this chat')
    await this.ensureConnected()
    await archiveClaudeThread(this.sdk!, sessionId, this.cwd)
    if (sessionId === this.session?.sessionId) await this.newThread()
  }

  stop(): void {
    void this.session?.retire()
  }

  private async connect(warm: boolean): Promise<void> {
    this.setConnection({ state: 'starting', message: 'Starting Claude Code…' })
    try {
      this.sdk ??= await loadClaudeSdk()
      this.session ??= this.createSession(this.sdk)
      await this.resumePersistedSession()
      const runtime = this.session.ensureRuntime()
      const [infos, account] = await Promise.all([runtime.supportedModels(), runtime.accountInfo().catch(() => null)])
      this.modelInfos = infos
      const saved = this.settings.get()
      this.modelState.load(claudeModelCatalog(infos, saved.chatModelId, saved.chatReasoningEffort))
      await this.applyModelPreference()
      this.account = account && (account.email || account.apiProvider)
        ? { type: 'claude', email: account.email ?? null, planType: account.subscriptionType ?? null }
        : null
      if (!this.account) this.setConnection({ state: 'signed-out', message: SIGN_IN_MESSAGE })
      else this.setConnection({ state: 'ready', message: 'Claude Code is ready' })
      if (!warm && !this.activeTurnId) await this.session.retire()
    } catch (error) {
      const message = messageOf(error)
      this.setConnection(/log ?in|authenticat|not signed|credential/i.test(message)
        ? { state: 'signed-out', message: SIGN_IN_MESSAGE }
        : { state: 'unavailable', message: `Claude Code is unavailable: ${message}` })
      await this.session?.retire()
    }
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  private createSession(sdk: ClaudeSdk): ClaudeSession {
    return new ClaudeSession({
      sdk,
      cwd: this.cwd,
      mcpServers: () => claudeMcpServers(sdk, this.tools, () => ({
        threadId: this.session?.sessionId ? claudeThreadId(this.session.sessionId) : null,
        turnId: this.activeTurnId
      })),
      systemPromptAppend: claudeSystemPromptAppend(this.cwd),
      displayScreenshot: (callId) => this.screenshots?.get(callId) ?? null,
      apply: (op) => this.applyOp(op),
      onTurn: (turnId) => this.setTurn(turnId),
      onSessionId: (sessionId) => this.adoptSessionId(sessionId),
      onTurnEnd: (turnId, end) => this.onTurnEnd(turnId, end),
      onContextUsage: (usage) => this.noteContextUsage(usage)
    })
  }

  /** Bring the saved session's transcript back before any process is spawned to resume it. */
  private async resumePersistedSession(): Promise<void> {
    const persisted = this.settings.get().chatClaudeSessionId
    if (!persisted || this.session!.sessionId) return
    try {
      await this.resumeSession(persisted)
    } catch (error) {
      console.warn('[claude] could not resume saved session:', messageOf(error))
      await this.detachThread()
    }
  }

  private async resumeSession(sessionId: string): Promise<void> {
    const sdk = this.sdk!
    const items = await replayClaudeSession(sdk, sessionId, { cwd: this.cwd, displayScreenshot: (callId) => this.screenshots?.get(callId) ?? null })
    await this.session!.adopt(sessionId)
    this.transcript.replaceItems(items)
    this.contextUsage = null
    this.pendingHandoff = null
    this.threadName = await claudeThreadName(sdk, sessionId, this.cwd).catch(() => null)
    await this.settings.set({ chatClaudeSessionId: sessionId })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  private async detachThread(): Promise<void> {
    await this.session?.reset()
    this.transcript.clear()
    this.threadName = null
    this.contextUsage = null
    this.pendingHandoff = null
    this.activeTurnId = null
    await this.settings.set({ chatClaudeSessionId: null })
  }

  private async applyModelPreference(): Promise<void> {
    if (!this.session) return
    const value = claudeModelValue(this.modelState.selectedModel)
    await this.session.setModel(value, supportsAdaptiveThinking(this.modelInfos, value))
    await this.session.setEffort(this.modelState.selectedReasoningEffort)
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

  private adoptSessionId(sessionId: string): void {
    void this.settings.set({ chatClaudeSessionId: sessionId })
    this.emitEvent({ type: 'thread', threadId: claudeThreadId(sessionId), threadName: this.threadName })
  }

  private onTurnEnd(turnId: string, end: TurnEnd): void {
    if (end.status === 'interrupted') this.addNotice('Turn stopped', 'info', turnId)
    if (end.status === 'failed') this.addNotice(end.error ?? 'The turn failed', 'error', turnId)
    void this.refreshThreadName()
  }

  /** The CLI titles a session shortly after its first turn; pick that up for the header. */
  private async refreshThreadName(): Promise<void> {
    const sessionId = this.session?.sessionId
    if (!sessionId || !this.sdk) return
    const name = await claudeThreadName(this.sdk, sessionId, this.cwd).catch(() => null)
    if (!name || name === this.threadName || sessionId !== this.session?.sessionId) return
    this.threadName = name
    this.emitEvent({ type: 'thread', threadId: claudeThreadId(sessionId), threadName: name })
  }

  private noteContextUsage(usage: ContextUsage): void {
    this.contextUsage = usage
    this.emitEvent({ type: 'context', usage: describeUsage(usage) })
  }

  private addNotice(text: string, tone: 'info' | 'error', turnId: string | null = this.activeTurnId): void {
    this.transcript.addNotice(text, tone, turnId)
  }

  private setConnection(connection: ChatConnection): void {
    this.connection = connection
    this.emitEvent({
      type: 'connection',
      provider: 'claude',
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
    this.emitEvent({ type: 'turn', turnId })
  }

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
  }
}
