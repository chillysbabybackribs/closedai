import { EventEmitter } from 'node:events'
import type {
  ChatAttachment,
  ChatEvent,
  ChatProvider,
  ChatSnapshot,
  ChatThreadSummary
} from '../shared/chat.js'
import { CHAT_PROVIDERS, chatProviderOfId } from '../shared/chat-providers.js'

// One chat pane, several providers. Each provider owns its own thread, transcript, and
// connection; the hub owns which one the pane shows, merges the model catalogs so the picker
// can switch providers from any state, and routes every call by the id it carries. Picking a
// model from another provider switches the pane to that provider's current thread (the old one
// stays in history), which keeps a thread bound to the backend that can actually continue it.

/** What the chat IPC drives: the hub, or a single provider in tests. */
export type ChatSurface = {
  snapshot(): ChatSnapshot
  start(): Promise<void>
  stop(): void
  send(text: string, attachments: ChatAttachment[]): Promise<void>
  interrupt(): Promise<void>
  selectModel(modelId: string): Promise<void>
  selectReasoningEffort(effort: string): Promise<void>
  listThreads(): Promise<ChatThreadSummary[]>
  newThread(): Promise<void>
  continueInNewThread(): Promise<void>
  openThread(threadId: string): Promise<void>
  archiveThread(threadId: string): Promise<void>
  /** Begin a sign-in; resolves to a URL to open, or null when the provider signs in elsewhere. */
  beginLogin(): Promise<string | null>
  on(event: 'event', listener: (event: ChatEvent) => void): unknown
}

export type ChatProviderService = Omit<ChatSurface, 'beginLogin' | 'start'> & {
  start(options?: { warm?: boolean }): Promise<void>
}

export type ChatHubProviders = {
  codex: ChatProviderService & { beginChatGptLogin(): Promise<string> }
  claude: ChatProviderService
  antigravity: ChatProviderService
}

export class ChatHub extends EventEmitter implements ChatSurface {
  private active: ChatProvider

  constructor(private readonly providers: ChatHubProviders, initialModelId: string | null) {
    super()
    this.active = chatProviderOfId(initialModelId)
    for (const name of CHAT_PROVIDERS) {
      providers[name].on('event', (event: ChatEvent) => this.onProviderEvent(name, event))
    }
  }

  get activeProvider(): ChatProvider {
    return this.active
  }

  snapshot(): ChatSnapshot {
    return this.merge(this.current().snapshot())
  }

  /** Every provider starts; only the active one stays warm (the CLI-backed ones close again). */
  async start(): Promise<void> {
    await Promise.all(CHAT_PROVIDERS.map((name) =>
      this.providers[name].start({ warm: this.active === name })
        .catch((error: unknown) => console.warn(`[chat] ${name} start failed:`, error))
    ))
  }

  stop(): void {
    for (const name of CHAT_PROVIDERS) this.providers[name].stop()
  }

  send(text: string, attachments: ChatAttachment[]): Promise<void> {
    return this.current().send(text, attachments)
  }

  interrupt(): Promise<void> {
    return this.current().interrupt()
  }

  async selectModel(modelId: string): Promise<void> {
    const target = chatProviderOfId(modelId)
    if (target === this.active) return this.current().selectModel(modelId)
    await this.switchTo(target, () => this.providers[target].selectModel(modelId))
  }

  selectReasoningEffort(effort: string): Promise<void> {
    return this.current().selectReasoningEffort(effort)
  }

  /** Every provider's threads, newest first; one provider being down hides only its threads. */
  async listThreads(): Promise<ChatThreadSummary[]> {
    const lists = await Promise.allSettled(CHAT_PROVIDERS.map((name) => this.providers[name].listThreads()))
    const threads = lists.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    if (lists.every((result) => result.status === 'rejected')) throw (lists[0] as PromiseRejectedResult).reason
    return threads.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  newThread(): Promise<void> {
    return this.current().newThread()
  }

  continueInNewThread(): Promise<void> {
    return this.current().continueInNewThread()
  }

  async openThread(threadId: string): Promise<void> {
    const target = chatProviderOfId(threadId)
    if (target === this.active) return this.current().openThread(threadId)
    await this.switchTo(target, () => this.providers[target].openThread(threadId))
  }

  archiveThread(threadId: string): Promise<void> {
    return this.providers[chatProviderOfId(threadId)].archiveThread(threadId)
  }

  async beginLogin(): Promise<string | null> {
    if (this.active === 'codex') return this.providers.codex.beginChatGptLogin()
    // Claude Code and Antigravity sign in from their own CLIs; re-checking picks up a login
    // completed elsewhere.
    await this.current().start({ warm: true })
    return null
  }

  private current(): ChatProviderService {
    return this.providers[this.active]
  }

  /** Switch the pane to another provider after its own action succeeds; the old thread stays put. */
  private async switchTo(target: ChatProvider, action: () => Promise<void>): Promise<void> {
    if (this.current().snapshot().activeTurnId) throw new Error('Stop the current turn before switching models')
    await action()
    this.active = target
    this.emitEvent({ type: 'replace', snapshot: this.snapshot() })
  }

  private merge(snapshot: ChatSnapshot): ChatSnapshot {
    return { ...snapshot, models: this.models() }
  }

  private models(): ChatSnapshot['models'] {
    return CHAT_PROVIDERS.flatMap((name) => this.providers[name].snapshot().models)
  }

  private onProviderEvent(source: ChatProvider, event: ChatEvent): void {
    if (event.type === 'connection') {
      // Any provider's catalog or connection changing re-describes the pane in terms of the
      // active provider, with every model merged in so the picker can offer the others.
      const active = this.current().snapshot()
      this.emitEvent({
        type: 'connection',
        provider: this.active,
        connection: active.connection,
        account: active.account,
        models: this.models(),
        selectedModel: active.selectedModel,
        selectedReasoningEffort: active.selectedReasoningEffort
      })
      return
    }
    if (source !== this.active) return
    if (event.type === 'replace') this.emitEvent({ type: 'replace', snapshot: this.merge(event.snapshot) })
    else this.emitEvent(event)
  }

  private emitEvent(event: ChatEvent): void {
    this.emit('event', event)
  }
}
