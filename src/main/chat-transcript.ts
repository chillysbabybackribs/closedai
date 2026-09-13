import { activityPhase, type ActivityTiming, type ChatAttachmentSummary, type ChatEvent, type ChatTranscriptItem } from '../shared/chat.js'
import { cloneItem, normalizeItem, nullableString, recordOf, stringOf } from './chat-normalizers.js'
import type { ChatHistoryPage, ChatHistoryWindow } from '../shared/chat.js'
import { tailTurnSlice, turnsBeforeIndex } from '../shared/chat-turn-page.js'

type EmitChatEvent = (event: ChatEvent) => void
/** Full-resolution capture for a tool call id, when the app still holds one. */
type DisplayScreenshot = (callId: string) => { dataUrl: string } | null

export class ChatTranscript {
  private readonly items = new Map<string, ChatTranscriptItem>()
  private readonly order: string[] = []
  private readonly positions = new Map<string, number>()
  private readonly backgroundIds = new Set<string>()
  private lastUserPosition = -1
  private readonly optimisticUsers = new Map<string, string>()
  private replaying = false

  constructor(
    private readonly cwd: string,
    private readonly activeTurn: () => string | null,
    private readonly emit: EmitChatEvent,
    private readonly displayScreenshot: DisplayScreenshot = () => null,
    private readonly now: () => number = Date.now
  ) {}

  snapshot(): ChatTranscriptItem[] {
    return this.order.flatMap((id) => {
      const item = this.items.get(id)
      return item ? [cloneItem(item)] : []
    })
  }

  get isEmpty(): boolean {
    return this.order.length === 0
  }

  /** Clone only the requested display page. Stable item ids survive appends during paging. */
  page(window: ChatHistoryWindow): ChatHistoryPage {
    if (window.unit === 'turn') return this.turnPage(window)
    if (!Number.isInteger(window.limit) || window.limit < 0) throw new Error('Invalid history page size')
    const end = window.beforeItemId === undefined ? this.order.length : this.positions.get(window.beforeItemId) ?? -1
    if (end < 0) throw new Error('History changed; reopen this chat to reload earlier messages')
    const start = Math.max(0, end - window.limit)
    const backgroundTasks = window.limit > 0 && window.beforeItemId === undefined
      ? [...this.backgroundIds].flatMap((id) => {
        const item = this.items.get(id)!
        const position = this.positions.get(id)!
        if (position >= start || item.type !== 'tool') return []
        const live = ['running', 'pending'].includes(activityPhase(item.status))
        return live || position > this.lastUserPosition ? [cloneItem(item)] : []
      })
      : []
    return { items: this.order.slice(start, end).map((id) => cloneItem(this.items.get(id)!)), hasEarlier: start > 0,
      ...(backgroundTasks.length ? { backgroundTasks } : {}) }
  }

  /** One or more user/model turns for the renderer and history paging. */
  turnPage(window: ChatHistoryWindow): ChatHistoryPage {
    const turns = window.limit
    if (!Number.isInteger(turns) || turns < 0) throw new Error('Invalid turn page size')
    const all = this.snapshot()
    const end = window.beforeItemId === undefined
      ? all.length
      : all.findIndex((item) => item.id === window.beforeItemId)
    if (window.beforeItemId !== undefined && end < 0) throw new Error('History changed; reopen this chat to reload earlier messages')
    const slice = window.beforeItemId === undefined
      ? tailTurnSlice(all, turns || 1)
      : turnsBeforeIndex(all, end, turns || 1)
    const backgroundTasks = window.beforeItemId === undefined
      ? this.backgroundTasksBefore(all, slice.start)
      : []
    return {
      items: all.slice(slice.start, slice.end),
      hasEarlier: slice.hasEarlier,
      ...(backgroundTasks.length ? { backgroundTasks } : {})
    }
  }

  private backgroundTasksBefore(items: ChatTranscriptItem[], start: number): ChatTranscriptItem[] {
    if (start <= 0) return []
    let lastUser = items.length - 1
    while (lastUser >= 0 && items[lastUser]?.type !== 'user') lastUser -= 1
    return items.slice(0, start).flatMap((item, index) => {
      if (item.type !== 'tool' || !item.background) return []
      const live = ['running', 'pending'].includes(activityPhase(item.status))
      return live || index > lastUser ? [cloneItem(item)] : []
    })
  }

  addOptimisticUser(clientId: string, text: string, attachments: ChatAttachmentSummary[] = []): void {
    const id = `user:${clientId}`
    this.optimisticUsers.set(clientId, id)
    this.upsert({ type: 'user', id, turnId: null, text, ...(attachments.length ? { attachments } : {}) })
  }

  consume(raw: unknown, turnId: string | null, completed: boolean): void {
    const record = recordOf(raw)
    if (!record) return
    const type = stringOf(record.type)
    const rawId = stringOf(record.id)
    if (!rawId) return
    const clientId = type === 'userMessage' ? nullableString(record.clientId) : null
    const id = clientId ? this.optimisticUsers.get(clientId) ?? rawId : rawId
    const item = normalizeItem(record, id, turnId, completed)
    const optimistic = this.items.get(id)
    if (item?.type === 'user' && optimistic?.type === 'user' && optimistic.attachments?.length) {
      item.attachments = optimistic.attachments
    }
    // The model was handed a scaled image; the transcript shows the full capture when it is still held.
    if (item?.type === 'screenshot') item.imageUrl = this.displayScreenshot(id)?.dataUrl ?? item.imageUrl
    if (item) this.upsert(item)
  }

  replaceFromThread(thread: Record<string, unknown>): void {
    this.clear()
    if (!Array.isArray(thread.turns)) return
    this.replaying = true
    try {
      for (const rawTurn of thread.turns) {
        const turn = recordOf(rawTurn)
        if (!turn || !Array.isArray(turn.items)) continue
        const turnId = stringOf(turn.id)
        for (const item of turn.items) this.consume(item, turnId, true)
      }
    } finally {
      this.replaying = false
    }
  }

  /** Replace every item without emitting; the caller follows with a snapshot replace. */
  replaceItems(items: ChatTranscriptItem[]): void {
    this.clear()
    for (const item of items) {
      this.indexItem(item)
      this.items.set(item.id, cloneItem(item))
    }
  }

  upsert(incoming: ChatTranscriptItem): void {
    const item = this.stampTiming(incoming)
    const appended = !this.items.has(item.id)
    this.indexItem(item)
    this.items.set(item.id, item)
    if (!this.replaying) this.emit({ type: 'item', item: cloneItem(item), appended })
  }

  private indexItem(item: ChatTranscriptItem): void {
    if (!this.positions.has(item.id)) {
      this.positions.set(item.id, this.order.length)
      this.order.push(item.id)
    }
    if (item.type === 'user') this.lastUserPosition = Math.max(this.lastUserPosition, this.positions.get(item.id)!)
    if (item.type === 'tool' && item.background) this.backgroundIds.add(item.id)
    else this.backgroundIds.delete(item.id)
  }

  /**
   * Providers say what an activity is doing, never when: the app clock supplies the
   * start when an item first shows up running and the finish when it settles. A settled
   * item that was never seen running (history replay) stays unstamped rather than
   * claiming a zero-length duration.
   */
  private stampTiming(item: ChatTranscriptItem): ChatTranscriptItem {
    if (item.type === 'assistant') {
      const previous = this.items.get(item.id)
      const createdAt = item.createdAt ?? (previous?.type === 'assistant' ? previous.createdAt : undefined)
        ?? (item.streaming ? this.now() : undefined)
      return createdAt === undefined ? item : { ...item, createdAt }
    }
    if (item.type !== 'command' && item.type !== 'fileChange' && item.type !== 'tool') return item
    const previous = timingOf(this.items.get(item.id))
    const running = activityPhase(item.status) === 'running'
    const startedAt = item.startedAt ?? previous.startedAt ?? (running ? this.now() : undefined)
    if (startedAt === undefined) return item
    if (running) return { ...item, startedAt }
    return { ...item, startedAt, finishedAt: item.finishedAt ?? previous.finishedAt ?? this.now() }
  }

  appendDelta(itemId: string, field: 'text' | 'output', delta: string): void {
    if (!itemId || !delta) return
    const existing = this.items.get(itemId)
    if (!existing) {
      const placeholder: ChatTranscriptItem = field === 'output'
        ? { type: 'command', id: itemId, turnId: this.activeTurn(), command: 'Command', cwd: this.cwd, status: 'inProgress', output: delta, exitCode: null }
        : { type: 'assistant', id: itemId, turnId: this.activeTurn(), text: delta, phase: null, streaming: true }
      this.upsert(placeholder)
      return
    }
    if (field === 'text' && (existing.type === 'assistant' || existing.type === 'plan' || existing.type === 'reasoning')) {
      existing.text += delta
    } else if (field === 'output' && existing.type === 'command') {
      existing.output += delta
    } else {
      return
    }
    this.emit({ type: 'itemDelta', itemId, field, delta })
  }

  addNotice(text: string, tone: 'info' | 'error', turnId: string | null = this.activeTurn()): void {
    this.upsert({ type: 'notice', id: `notice:${crypto.randomUUID()}`, turnId, text, tone })
  }

  clear(): void {
    this.items.clear()
    this.order.length = 0
    this.positions.clear()
    this.backgroundIds.clear()
    this.lastUserPosition = -1
    this.optimisticUsers.clear()
  }
}

function timingOf(item: ChatTranscriptItem | undefined): ActivityTiming {
  if (!item || (item.type !== 'command' && item.type !== 'fileChange' && item.type !== 'tool')) return {}
  return { startedAt: item.startedAt, finishedAt: item.finishedAt }
}
