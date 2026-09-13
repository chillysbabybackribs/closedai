import { EventEmitter } from 'node:events'
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import type {
  ChatAccount,
  ChatAttachment,
  ChatConnection,
  ChatEvent,
  ChatHistoryWindow,
  ChatPlanUsage,
  ChatSnapshot,
  ChatThreadContent,
  ChatThreadSummary,
  ChatTurnContextReport
} from '../../shared/chat.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import { shrinkPastedImages } from '../chat-attachment-images.js'
import { describeUsage, type ContextUsage } from '../chat-context/context-compaction.js'
import { applyPlanUsageSignal, planUsageUnavailable, type ClaudeRateLimitSignal } from '../chat-context/plan-usage.js'
import {
  buildThreadHandoff,
  continuationFromThreadHandoff,
  handoffAdditionalContext,
  type ThreadHandoffSource
} from '../chat-context/thread-handoff.js'
import { buildTurnAdditionalContext, type ActiveBrowserContext } from '../chat-context/turn-context.js'
import { buildTurnContextReport } from '../chat-context/turn-inspector.js'
import { ChatModelState } from '../chat-model-state.js'
import { buildChatInput } from '../chat-input.js'
import { messageOf } from '../chat-normalizers.js'
import { ChatTranscript } from '../chat-transcript.js'
import type { ScreenshotStore } from '../tools/capture/screenshot-store.js'
import { ToolRegistry } from '../tools/registry.js'
import { forgetClaudeCatalog, readClaudeCatalog, rememberClaudeCatalog } from './claude-catalog.js'
import { archiveClaudeThread, claudeThreadName, listClaudeThreads, replayClaudeSession } from './claude-history.js'
import { claudeModelValue, claudeSessionIdOf, claudeThreadId } from './claude-ids.js'
import { buildClaudeUserMessage } from './claude-input.js'
import { claudeSystemPromptAppend } from './claude-instructions.js'
import { claudeModelCatalog, supportsAdaptiveThinking } from './claude-models.js'
import { loadClaudeSdk, type ClaudeSdk } from './claude-sdk.js'
import { ClaudeSession } from './claude-session.js'
import { applyTranscriptOp, handleProviderTurnEnd, type TranscriptOp, type TurnEnd } from '../chat-transcript-ops.js'
import { claudeMcpServers } from './claude-tools.js'

// The Claude Code provider, mirroring ChatService's surface so the hub can route to either.
// Everything model-facing is the Claude Agent SDK: the process, the tools (as in-process MCP
// servers over the shared registry), the session store that is also the chat history.

/** Waits between checks for a still-untitled session after a turn ends, then stop asking. */
const THREAD_NAME_RETRY_MS = [3_000, 8_000, 20_000]

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
  private pausedTurnId: string | null = null
  private contextUsage: ContextUsage | null = null
  private planUsage: ChatPlanUsage | null = null
  private turnContext: ChatTurnContextReport | null = null
  private readonly transcript: ChatTranscript
  private startPromise: Promise<void> | null = null

  constructor(
    readonly cwd: string,
    private readonly settings: AppSettingsAccess,
    private readonly tools: ToolRegistry = new ToolRegistry([]),
    private readonly activeBrowserContext: () => ActiveBrowserContext | null = () => null,
    private readonly screenshots: Pick<ScreenshotStore, 'get'> | null = null,
    private readonly paneId: string | null = null
  ) {
    super()
    this.transcript = new ChatTranscript(cwd, () => this.activeTurnId, (event) => this.emitEvent(event), (callId) => screenshots?.get(callId) ?? null)
  }

  snapshot(window?: ChatHistoryWindow): ChatSnapshot {
    const page = window ? this.transcript.page(window) : null
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
      pausedTurnId: this.pausedTurnId,
      contextUsage: describeUsage(this.contextUsage),
      planUsage: this.planUsage,
      turnContext: this.turnContext,
      items: page?.items ?? this.transcript.snapshot(),
      ...(page ? { history: { hasEarlier: page.hasEarlier, backgroundTasks: page.backgroundTasks } } : {})
    }
  }

  /** Load the SDK, read the catalog and account, and resume the saved session's transcript. */
  start(options: { warm?: boolean } = {}): Promise<void> {
    this.startPromise ??= this.connect(options.warm === true).finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async send(text: string, attachments: ChatAttachment[] = [], prepare?: () => Promise<void>): Promise<void> {
    try {
      const shrunk = shrinkPastedImages(attachments)
      const { prompt, input, summaries } = buildChatInput(text, shrunk)
      if (input.length === 0) return
      if (this.activeTurnId) throw new Error('A Claude turn is already running')
      // Paint the accepted message before anything that can take a moment. Painting it last held
      // a new chat on its empty state — composer text and all — through the provider's start, the
      // catalog read and the turn context, which is most of the wait before a first reply.
      this.transcript.addOptimisticUser(crypto.randomUUID(), prompt, summaries)
      await prepare?.()
      await this.ensureReady()
      const session = this.session!
      if (this.activeTurnId) throw new Error('A Claude turn is already running')
      const sessionId = session.sessionId
      const pendingHandoff = this.settings.get().chatContinuation?.handoff ?? null
      const context = {
        ...this.turnAdditionalContext(text),
        ...(pendingHandoff ? handoffAdditionalContext(pendingHandoff) : {})
      }
      const turn = await buildClaudeUserMessage(text, shrunk, Object.keys(context).length ? context : undefined, session.sessionId)
      if (!turn) return
      if (this.session !== session || (sessionId && session.sessionId !== sessionId) || this.activeTurnId) throw new Error('Claude conversation changed while preparing the turn')
      session.send(turn.message)
      this.setTurnContext(buildTurnContextReport({
        provider: 'claude',
        model: this.modelState.selectedModel,
        threadId: session.sessionId ? claudeThreadId(session.sessionId) : null,
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

  async interrupt(): Promise<void> {
    try {
      await this.session?.interrupt()
    } catch (error) {
      this.addNotice(`Could not stop the turn: ${messageOf(error)}`, 'error')
      throw error
    }
  }

  /**
   * Read the plan windows from the live process. There may be none — usage is not worth a
   * spawn — in which case the last reading stands, dated, rather than being cleared.
   */
  async refreshPlanUsage(): Promise<void> {
    const usage = await this.session?.planUsage().catch(() => null) ?? null
    if (usage) this.setPlanUsage(usage)
    // No process and nothing read yet: say so rather than leaving the card reading forever.
    else if (!this.planUsage) this.setPlanUsage(planUsageUnavailable('Send a message to read plan usage.'))
  }

  async selectModel(modelId: string): Promise<void> {
    if (this.activeTurnId) throw new Error('Stop the current turn before changing models')
    const preference = this.modelState.preferenceForModel(modelId)
    await this.settings.set({ chatModelId: modelId, chatReasoningEffort: preference.effort })
    this.modelState.apply(preference)
    // The pick shows first; telling the live session is a round trip the picker need not wait for.
    this.emitEvent({ type: 'model', selectedModel: modelId, selectedReasoningEffort: preference.effort })
    await this.applyModelPreference()
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
    if (!this.sdk) this.sdk = await loadClaudeSdk()
    return listClaudeThreads(this.sdk, this.cwd)
  }

  async readThread(threadId: string, cwd = this.cwd): Promise<ChatThreadContent> {
    const sessionId = claudeSessionIdOf(threadId)
    if (!sessionId) throw new Error('Invalid Claude thread')
    await this.ensureConnected()
    const items = await replayClaudeSession(this.sdk!, sessionId, {
      cwd,
      displayScreenshot: (callId) => this.screenshots?.get(callId) ?? null
    })
    const threadName = await claudeThreadName(this.sdk!, sessionId, cwd).catch(() => null)
    return { threadId, threadName, items }
  }

  /** Clear the pane; the next message starts a fresh SDK session. */
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
    this.addNotice(`Continuing from “${source.title}”. A short summary of that chat goes with your next message.`, 'info', null)
  }

  /** This session as the digest its successor carries, or null when there is nothing to carry. */
  private ownHandoff(): ThreadHandoffSource | null {
    const handoff = buildThreadHandoff(this.transcript.snapshot(), this.threadName)
    if (!handoff) return null
    return { ...handoff, provider: 'claude', threadId: this.session?.sessionId ? claudeThreadId(this.session.sessionId) : null }
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
      // Asking the CLI for the catalogue costs a process spawn and about a second, and the
      // answer is the same for every pane in this workspace. Reuse it when the workspace has
      // one, so a new chat's composer is live immediately.
      let catalog = readClaudeCatalog(this.cwd)
      if (!catalog) {
        const runtime = this.session.ensureRuntime()
        const [models, account] = await Promise.all([runtime.supportedModels(), runtime.accountInfo().catch(() => null)])
        catalog = { models, account }
        rememberClaudeCatalog(this.cwd, catalog)
      }
      this.modelInfos = catalog.models
      const saved = this.settings.get()
      this.modelState.load(claudeModelCatalog(catalog.models, saved.chatModelId, saved.chatReasoningEffort))
      // Applied before the process exists, this only records the preference the spawn will use.
      await this.applyModelPreference()
      const account = catalog.account
      this.account = account && (account.email || account.apiProvider)
        ? { type: 'claude', email: account.email ?? null, planType: account.subscriptionType ?? null }
        : null
      if (!this.account) this.setConnection({ state: 'signed-out', message: SIGN_IN_MESSAGE })
      else this.setConnection({ state: 'ready', message: 'Claude Code is ready' })
      if (!this.activeTurnId) {
        // A warm start is on its way to a turn, so its process starts here rather than on the
        // message — but nothing waits for it: the queue holds the turn until the process is up.
        if (warm) {
          this.session.ensureRuntime()
          void this.refreshPlanUsage()
        } else await this.session.retire()
      }
    } catch (error) {
      forgetClaudeCatalog(this.cwd)
      const message = messageOf(error)
      this.setConnection(/log ?in|authenticat|not signed|credential/i.test(message)
        ? { state: 'signed-out', message: SIGN_IN_MESSAGE }
        : { state: 'unavailable', message: `Claude Code is unavailable: ${message}` })
      await this.session?.retire()
    }
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  private createSession(sdk: ClaudeSdk): ClaudeSession {
    const session = new ClaudeSession({
      sdk,
      cwd: this.cwd,
      mcpServers: () => claudeMcpServers(sdk, this.tools, () => ({
        paneId: this.paneId,
        threadId: this.session?.sessionId ? claudeThreadId(this.session.sessionId) : null,
        turnId: this.activeTurnId
      })),
      systemPromptAppend: claudeSystemPromptAppend(this.cwd),
      displayScreenshot: (callId) => this.screenshots?.get(callId) ?? null,
      apply: (op) => this.applyOp(op),
      onTurn: (turnId) => this.setTurn(turnId),
      onSessionId: (sessionId) => this.adoptSessionId(sessionId),
      onTurnEnd: (turnId, end) => this.onTurnEnd(turnId, end),
      onContextUsage: (usage) => this.noteContextUsage(usage),
      onPlanUsageSignal: (signal) => this.notePlanUsageSignal(signal),
      traceScope: () => ({ paneId: this.paneId, provider: 'claude', turnId: this.activeTurnId })
    })
    return session
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
    this.threadName = await claudeThreadName(sdk, sessionId, this.cwd).catch(() => null)
    await this.settings.set({ chatClaudeSessionId: sessionId, chatContinuation: null })
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  private async detachThread(): Promise<void> {
    await this.session?.reset()
    this.transcript.clear()
    this.threadName = null
    this.contextUsage = null
    this.activeTurnId = null
    this.turnContext = null
    await this.settings.set({ chatClaudeSessionId: null })
  }

  private async applyModelPreference(): Promise<void> {
    if (!this.session) return
    const value = claudeModelValue(this.modelState.selectedModel)
    await this.session.setModel(value, supportsAdaptiveThinking(this.modelInfos, value))
    await this.session.setEffort(this.modelState.selectedReasoningEffort)
  }

  private async clearDeliveredHandoff(): Promise<void> {
    const continuation = this.settings.get().chatContinuation
    if (continuation?.handoff) await this.settings.set({ chatContinuation: { ...continuation, handoff: null } })
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
    applyTranscriptOp(this.transcript, (text, tone) => this.addNotice(text, tone), op)
  }

  private adoptSessionId(sessionId: string): void {
    void this.settings.set({ chatClaudeSessionId: sessionId })
    this.emitEvent({ type: 'thread', threadId: claudeThreadId(sessionId), threadName: this.threadName })
  }

  private onTurnEnd(turnId: string, end: TurnEnd): void {
    handleProviderTurnEnd(turnId, end, {
      addNotice: (text, tone, id) => this.addNotice(text, tone, id),
      setPaused: (id) => this.setPaused(id)
    })
    void this.refreshThreadName()
    void this.refreshPlanUsage()
  }

  /**
   * The CLI titles a session in the background around its first turn. A short first turn can end
   * before the title lands, so an unnamed session is re-checked a few times before giving up
   * until the next turn; a renamed session (`/rename`, a later generated title) is picked up too.
   */
  private async refreshThreadName(attempt = 0): Promise<void> {
    const sessionId = this.session?.sessionId
    if (!sessionId || !this.sdk) return
    const name = await claudeThreadName(this.sdk, sessionId, this.cwd).catch(() => null)
    if (sessionId !== this.session?.sessionId) return
    if (name && name !== this.threadName) {
      this.threadName = name
      this.emitEvent({ type: 'thread', threadId: claudeThreadId(sessionId), threadName: name })
      return
    }
    const delay = THREAD_NAME_RETRY_MS[attempt]
    if (this.threadName || delay === undefined) return
    setTimeout(() => { void this.refreshThreadName(attempt + 1) }, delay).unref?.()
  }

  private noteContextUsage(usage: ContextUsage): void {
    this.contextUsage = usage
    this.emitEvent({ type: 'context', usage: describeUsage(usage) })
  }

  private notePlanUsageSignal(signal: ClaudeRateLimitSignal): void {
    this.setPlanUsage(applyPlanUsageSignal(this.planUsage, signal))
  }

  private setPlanUsage(usage: ChatPlanUsage | null): void {
    if (!usage) return
    this.planUsage = usage
    this.emitEvent({ type: 'planUsage', usage })
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
    if (turnId) this.setPaused(null)
    this.emitEvent({ type: 'turn', turnId })
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

  private setTurnContext(report: ChatTurnContextReport): void {
    this.turnContext = report
    this.emitEvent({ type: 'turnContext', report })
  }
}
