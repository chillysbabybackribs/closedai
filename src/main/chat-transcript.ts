import type { ChatAttachmentSummary, ChatEvent, ChatTranscriptItem } from '../shared/chat.js'
import { cloneItem, normalizeItem, nullableString, recordOf, stringOf } from './chat-normalizers.js'

type EmitChatEvent = (event: ChatEvent) => void
/** Full-resolution capture for a tool call id, when the app still holds one. */
type DisplayScreenshot = (callId: string) => { dataUrl: string } | null

export class ChatTranscript {
  private readonly items = new Map<string, ChatTranscriptItem>()
  private readonly order: string[] = []
  private readonly optimisticUsers = new Map<string, string>()

  constructor(
    private readonly cwd: string,
    private readonly activeTurn: () => string | null,
    private readonly emit: EmitChatEvent,
    private readonly displayScreenshot: DisplayScreenshot = () => null
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
    for (const rawTurn of thread.turns) {
      const turn = recordOf(rawTurn)
      if (!turn || !Array.isArray(turn.items)) continue
      const turnId = stringOf(turn.id)
      for (const item of turn.items) this.consume(item, turnId, true)
    }
  }

  /** Replace every item without emitting; the caller follows with a snapshot replace. */
  replaceItems(items: ChatTranscriptItem[]): void {
    this.clear()
    for (const item of items) {
      if (!this.items.has(item.id)) this.order.push(item.id)
      this.items.set(item.id, cloneItem(item))
    }
  }

  upsert(item: ChatTranscriptItem): void {
    if (!this.items.has(item.id)) this.order.push(item.id)
    this.items.set(item.id, item)
    this.emit({ type: 'item', item: cloneItem(item) })
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
    this.optimisticUsers.clear()
  }
}
