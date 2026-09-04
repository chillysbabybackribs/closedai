import { readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatContextUsage, ChatSnapshot, ChatTranscriptItem } from '../../shared/chat.js'
import { writeAtomic } from '../atomic-write.js'

// The last thing the app saw of each chat, on disk, so opening one paints before its provider is
// up. A transcript belongs to the provider that owns the thread, and reaching it costs a process
// start and a full replay — seconds for the CLI providers — during which the pane had nothing to
// show but the empty "new chat" layout, no model on the composer, and no context reading. This
// cache is display-only: the provider's replay replaces it the moment it lands, nothing is ever
// sent to a model from here, and a missing or unreadable entry only costs the old blank wait.

/** How much of the tail is kept: enough to fill the first screen, not the whole conversation. */
export const CACHED_TRANSCRIPT_ITEMS = 60

/** Ceiling per chat, so one conversation full of long diffs cannot own the cache directory. */
export const CACHED_TRANSCRIPT_BYTES = 256 * 1024

const WRITE_DELAY_MS = 400

/** One chat as the app last showed it. */
export type CachedChatView = {
  version: 1
  /** The thread these items came from; a view is used only while the chat still holds it. */
  threadId: string
  threadName: string | null
  items: ChatTranscriptItem[]
  /** Whether the conversation continues above the kept tail. */
  hasEarlier: boolean
  contextUsage: ChatContextUsage | null
  updatedAt: number
}

/** The bounded tail of a snapshot: the last items that fit both caps, oldest dropped first. */
export function cachedViewOf(threadId: string, snapshot: ChatSnapshot): CachedChatView {
  const tail = snapshot.items.slice(-CACHED_TRANSCRIPT_ITEMS)
  let dropped = snapshot.items.length - tail.length
  let bytes = tail.reduce((total, item) => total + JSON.stringify(item).length, 0)
  while (tail.length > 1 && bytes > CACHED_TRANSCRIPT_BYTES) {
    const oldest = tail.shift()!
    bytes -= JSON.stringify(oldest).length
    dropped += 1
  }
  return {
    version: 1,
    threadId,
    threadName: snapshot.threadName,
    items: tail,
    hasEarlier: dropped > 0 || Boolean(snapshot.history?.hasEarlier),
    contextUsage: snapshot.contextUsage,
    updatedAt: Date.now()
  }
}

export class ChatTranscriptCache {
  /** Chats read or written this session; a `null` entry is a chat known to have no view. */
  private readonly views = new Map<string, CachedChatView | null>()
  private readonly reads = new Map<string, Promise<CachedChatView | null>>()
  private readonly pending = new Set<string>()
  private writeTimer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly dir: string | null) {}

  /** A cache that never touches disk, for tests and headless runs. */
  static inMemory(views: Array<[string, CachedChatView]> = []): ChatTranscriptCache {
    const cache = new ChatTranscriptCache(null)
    for (const [chatId, view] of views) cache.views.set(chatId, view)
    return cache
  }

  /** The view already in memory; snapshots are synchronous, so reading from disk happens first. */
  peek(chatId: string): CachedChatView | null {
    return this.views.get(chatId) ?? null
  }

  /** Bring a chat's view into memory before its pane paints. Concurrent calls share one read. */
  load(chatId: string): Promise<CachedChatView | null> {
    const known = this.views.get(chatId)
    if (known !== undefined) return Promise.resolve(known)
    if (!this.dir) {
      this.views.set(chatId, null)
      return Promise.resolve(null)
    }
    let read = this.reads.get(chatId)
    if (!read) {
      read = this.readView(chatId).then((view) => {
        // A write that landed while the read was in flight is the newer truth — but it was taken
        // from a provider that had just replayed, so the reading it lacks is still this one's.
        const current = this.views.get(chatId)
        this.views.set(chatId, current ? carryReading(view, current) : current === undefined ? view : null)
        this.reads.delete(chatId)
        return this.views.get(chatId) ?? null
      })
      this.reads.set(chatId, read)
    }
    return read
  }

  /** Record what the chat looks like now; the write follows shortly after the last change. */
  remember(chatId: string, threadId: string, snapshot: ChatSnapshot): void {
    if (snapshot.items.length === 0) return
    const current = this.views.get(chatId) ?? null
    const view = carryReading(current, cachedViewOf(threadId, snapshot))
    this.views.set(chatId, view)
    if (current && sameView(current, view)) return
    this.schedule(chatId)
  }

  /** Drop a chat's view: it was archived, or its conversation is gone. */
  forget(chatId: string): void {
    if (this.views.get(chatId) === null) return
    this.views.set(chatId, null)
    this.schedule(chatId)
  }

  /** Remove entries for chats the store no longer has, so the directory follows the drawer. */
  async prune(keep: ReadonlySet<string>): Promise<void> {
    if (!this.dir) return
    const files = await readdir(this.dir).catch(() => [] as string[])
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const chatId = decodeChatId(file.slice(0, -'.json'.length))
      if (keep.has(chatId)) continue
      this.views.delete(chatId)
      await unlink(join(this.dir, file)).catch(() => {})
    }
  }

  /** Wait for every scheduled write to land; called before quit. */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
      this.persist()
    }
    await this.writing
  }

  private schedule(chatId: string): void {
    if (!this.dir) return
    this.pending.add(chatId)
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.persist()
    }, WRITE_DELAY_MS)
    this.writeTimer.unref?.()
  }

  private persist(): void {
    const dir = this.dir
    if (!dir || this.pending.size === 0) return
    const writes = [...this.pending].map((chatId) => ({ chatId, view: this.views.get(chatId) ?? null }))
    this.pending.clear()
    this.writing = this.writing
      .then(async () => {
        for (const { chatId, view } of writes) {
          const path = join(dir, `${encodeChatId(chatId)}.json`)
          if (view) await writeAtomic(path, `${JSON.stringify(view)}\n`)
          else await unlink(path).catch(() => {})
        }
      })
      .catch((error: unknown) => {
        console.warn('[chat-transcripts] could not save:', error instanceof Error ? error.message : String(error))
      })
  }

  private async readView(chatId: string): Promise<CachedChatView | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.dir!, `${encodeChatId(chatId)}.json`), 'utf8'))
      return normalizeCachedView(parsed)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') {
        console.warn('[chat-transcripts] unreadable entry:', error instanceof Error ? error.message : String(error))
      }
      return null
    }
  }
}

/** Chat ids carry a provider prefix (`claude:…`), which is not a filename on every platform. */
function encodeChatId(chatId: string): string {
  return encodeURIComponent(chatId)
}

function decodeChatId(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** A file written by an older build, or half-written, is worth nothing but must not throw. */
export function normalizeCachedView(parsed: unknown): CachedChatView | null {
  if (!parsed || typeof parsed !== 'object') return null
  const view = parsed as Partial<CachedChatView>
  if (view.version !== 1 || typeof view.threadId !== 'string' || !Array.isArray(view.items)) return null
  const items = view.items.filter((item): item is ChatTranscriptItem =>
    Boolean(item) && typeof item === 'object' && typeof (item as ChatTranscriptItem).id === 'string' &&
    typeof (item as ChatTranscriptItem).type === 'string')
  if (items.length === 0) return null
  return {
    version: 1,
    threadId: view.threadId,
    threadName: typeof view.threadName === 'string' ? view.threadName : null,
    items,
    hasEarlier: view.hasEarlier === true || items.length < view.items.length,
    contextUsage: normalizeUsage(view.contextUsage),
    updatedAt: typeof view.updatedAt === 'number' ? view.updatedAt : 0
  }
}

function normalizeUsage(usage: unknown): ChatContextUsage | null {
  if (!usage || typeof usage !== 'object') return null
  const { usedTokens, contextWindow, percent } = usage as Partial<ChatContextUsage>
  if (typeof usedTokens !== 'number' || typeof contextWindow !== 'number' || typeof percent !== 'number') return null
  return { usedTokens, contextWindow, percent }
}

/**
 * The newer view wins, except that a context reading outlives it while the thread is the same:
 * providers report the window per turn and clear it when they replay a thread, so saving a
 * resumed pane over a measured one would blank the composer's meter for good.
 */
function carryReading(previous: CachedChatView | null, next: CachedChatView): CachedChatView {
  if (next.contextUsage || !previous || previous.threadId !== next.threadId || !previous.contextUsage) return next
  return { ...next, contextUsage: previous.contextUsage }
}

/** Whether a new view says anything the stored one does not, so a re-read costs no write. */
function sameView(current: CachedChatView, next: CachedChatView): boolean {
  return current.threadId === next.threadId && current.threadName === next.threadName &&
    current.hasEarlier === next.hasEarlier &&
    JSON.stringify(current.contextUsage) === JSON.stringify(next.contextUsage) &&
    JSON.stringify(current.items) === JSON.stringify(next.items)
}
