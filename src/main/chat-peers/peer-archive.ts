import { ARCHIVE_UNDO_MS } from '../../shared/chat-peers.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import type { ChatSurface } from '../chat-hub.js'
import type { ChatStore } from '../chat-store/chat-store.js'

export type ArchiveHost = {
  assertAvailable(): void
  cancelSwitch(reason: string, chatId: string): void
  store: ChatStore
  attached(chatId: string): boolean
  attach(record: ChatRecord): void
  detach(chatId: string): void
  withAwake(chatId: string, fn: (surface: ChatSurface) => Promise<void>): Promise<void>
  closePeer(chatId: string): Promise<void>
  forgetTranscript(chatId: string): void
  invalidateCatalog(): void
  emitChats(): void
}

/** Timers that defer a provider archive so the renderer can undo. */
export class PendingArchives {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly commit: (id: string) => void,
    private readonly delayMs = ARCHIVE_UNDO_MS
  ) {}

  schedule(id: string): void {
    this.cancel(id)
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id)
      this.commit(id)
    }, this.delayMs))
  }

  cancel(id: string): boolean {
    const timer = this.timers.get(id)
    if (timer === undefined) return false
    clearTimeout(timer)
    this.timers.delete(id)
    return true
  }

  has(id: string): boolean {
    return this.timers.has(id)
  }

  ids(): string[] {
    return [...this.timers.keys()]
  }

  /** Drop timers without committing. Undo is gone after quit. */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}

/**
 * Trash hides a chat immediately. The provider thread and transcript stay until the undo
 * window expires, so Restore is a store unarchive rather than a missing provider unarchive.
 */
export class PeerArchives {
  private readonly pending: PendingArchives

  constructor(private readonly host: ArchiveHost, delayMs = ARCHIVE_UNDO_MS) {
    this.pending = new PendingArchives((id) => { void this.commit(id) }, delayMs)
  }

  /** Hide the chat now; schedule the provider archive after the undo window. */
  async archive(chatId: string): Promise<void> {
    this.host.assertAvailable()
    this.host.cancelSwitch('The requesting chat was archived', chatId)
    const record = this.host.store.get(chatId)
    if (!record || record.archived) return
    const attached = this.host.attached(chatId)
    this.host.store.archive(chatId)
    if (attached) await this.host.closePeer(chatId)
    this.host.invalidateCatalog()
    this.host.emitChats()
    this.pending.schedule(chatId)
  }

  async unarchive(chatId: string): Promise<void> {
    this.host.assertAvailable()
    const record = this.host.store.get(chatId)
    if (!record) return
    if (!this.pending.cancel(chatId)) {
      if (record.archived) throw new Error('That chat can no longer be restored')
      return
    }
    this.host.store.unarchive(chatId)
    this.host.invalidateCatalog()
    this.host.emitChats()
  }

  /** Provider archive, transcript drop, and store hide. Used after the undo window and by tools. */
  async commit(chatId: string): Promise<void> {
    this.pending.cancel(chatId)
    this.host.assertAvailable()
    this.host.cancelSwitch('The requesting chat was archived', chatId)
    const record = this.host.store.get(chatId)
    if (!record) return
    const attached = this.host.attached(chatId)
    if (record.threadId) {
      const threadId = record.threadId
      if (!attached) this.host.attach(record)
      try {
        await this.host.withAwake(chatId, (surface) => surface.archiveThread(threadId))
      } finally {
        if (!attached) this.host.detach(chatId)
      }
    }
    if (!record.archived) this.host.store.archive(chatId)
    this.host.forgetTranscript(chatId)
    if (attached) await this.host.closePeer(chatId)
    this.host.invalidateCatalog()
    this.host.emitChats()
  }

  async flush(): Promise<void> {
    const ids = this.pending.ids()
    for (const id of ids) this.pending.cancel(id)
    await Promise.all(ids.map((id) => this.commit(id)))
  }

  stop(): void {
    this.pending.stop()
  }
}
