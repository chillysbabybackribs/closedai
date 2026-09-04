import type { ChatEvent, ChatSnapshot, ChatTranscriptItem } from '../../shared/chat.js'
import type { ChatPeerSummary, PeerChatReadResult } from '../../shared/chat-peers.js'
import type { ChatRecord } from '../../shared/chat-store.js'

// How one pane describes itself to the drawer and to peer-reading tools. A parked pane has no
// runtime and an empty snapshot, so every field that names the chat falls back to the persisted
// record; otherwise a relaunch turned every background chat into a nameless "New chat".

export const PLACEHOLDER_TITLE = 'New chat'
const MAX_TITLE = 60
export const MAX_PEER_PREVIEW_CHARS = 240

/** Keeps only ordering ids and a bounded preview; transcript content stays with the provider. */
export class PeerSummaryCache {
  private readonly ids = new Set<string>()
  private latestId: string | null = null
  private textDelta = false
  private firstUserId: string | null = null
  private firstUserText: string | null = null
  private threadName: string | null = null
  current: ChatPeerSummary

  /**
   * The record is read on demand, not captured at attach: a "new chat" clears the pane's thread in
   * settings before the surface replays, and a frozen copy would keep naming the pane after the
   * conversation it just left.
   */
  constructor(private readonly paneId: string, private readonly readRecord: () => ChatRecord) {
    this.current = summaryForRecord(paneId, readRecord())
  }

  private get record(): ChatRecord {
    return this.readRecord()
  }

  update(event: ChatEvent, updatedAt: number): void {
    let summary = this.current
    if (event.type === 'replace') {
      this.ids.clear()
      for (const item of event.snapshot.items) this.ids.add(item.id)
      const first = event.snapshot.items.find((item) => item.type === 'user')
      this.firstUserId = first?.id ?? null
      this.firstUserText = first?.type === 'user' ? titleFromUserText(first.text) : null
      this.threadName = event.snapshot.threadName
      summary = summaryOf(this.paneId, event.snapshot, updatedAt, this.record)
      this.setLatest(event.snapshot.items.at(-1))
    } else if (event.type === 'connection') {
      summary = { ...summary, provider: event.provider, modelId: event.selectedModel ?? this.record.modelId }
    } else if (event.type === 'model') {
      summary = { ...summary, modelId: event.selectedModel }
    } else if (event.type === 'thread') {
      this.threadName = event.threadName
      summary = { ...summary, threadId: event.threadId }
    } else if (event.type === 'turn') {
      summary = { ...summary, running: event.turnId !== null }
    } else if (event.type === 'item') {
      const item = event.item
      const isNew = !this.ids.has(item.id)
      this.ids.add(item.id)
      if (item.type === 'user' && (this.firstUserId === null || this.firstUserId === item.id)) {
        this.firstUserId = item.id
        this.firstUserText = titleFromUserText(item.text)
      }
      if (isNew || item.id === this.latestId) {
        this.setLatest(item)
        summary = { ...summary, preview: itemText(item).slice(0, MAX_PEER_PREVIEW_CHARS), activity: item.type === 'tool' ? item.label : null }
      }
    } else if (event.type === 'itemDelta' && event.itemId === this.latestId && event.field === 'text' && this.textDelta) {
      summary = { ...summary, preview: (summary.preview + event.delta.slice(0, MAX_PEER_PREVIEW_CHARS)).slice(0, MAX_PEER_PREVIEW_CHARS) }
    }
    this.current = { ...summary, title: titleFromParts(this.threadName, this.firstUserText, this.record), updatedAt }
  }

  private setLatest(item: ChatTranscriptItem | undefined): void {
    this.latestId = item?.id ?? null
    this.textDelta = item?.type === 'assistant' || item?.type === 'plan' || item?.type === 'reasoning'
  }
}

/** The drawer can be described from persisted pane state before its provider is awake. */
export function summaryForRecord(paneId: string, record: ChatRecord): ChatPeerSummary {
  return {
    paneId,
    parentPaneId: null,
    kind: 'peer',
    provider: record.provider,
    modelId: record.modelId,
    threadId: record.threadId,
    title: titleFromParts(null, null, record),
    preview: record.preview,
    running: false,
    activity: null,
    updatedAt: record.updatedAt
  }
}

/** The provider's name for the thread, else the first message, else the saved or lineage name. */
export function paneTitle(snapshot: ChatSnapshot, record: TitleRecord): string {
  const firstUser = snapshot.items.find((item) => item.type === 'user')
  const fromMessage = firstUser?.type === 'user' ? firstLine(firstUser.text) : null
  return titleFromParts(snapshot.threadName, fromMessage, record)
}

/** First user messages arrive as events, so the manager can name a new pane without a snapshot. */
export function titleFromUserText(text: string): string {
  return formatTitle(firstLine(text))
}

type TitleRecord = Pick<ChatRecord, 'title' | 'threadId' | 'continuation'>

/**
 * A saved title names the saved thread. Once the record holds neither a thread nor a pending
 * continuation the pane is a blank chat, and the old name would only duplicate the History row
 * that thread now has of its own.
 */
function titleFromParts(threadName: string | null, firstUserText: string | null, record: TitleRecord): string {
  const saved = record.threadId || record.continuation ? record.title?.trim() : null
  const title = threadName?.trim() || firstUserText?.trim() || saved ||
    (record.continuation ? `Continuing: ${record.continuation.sourceTitle}` : PLACEHOLDER_TITLE)
  return formatTitle(title)
}

function formatTitle(title: string): string {
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title
}

export function summaryOf(
  paneId: string,
  snapshot: ChatSnapshot,
  updatedAt: number,
  record: ChatRecord
): ChatPeerSummary {
  const latest = snapshot.items.at(-1)
  return {
    paneId,
    parentPaneId: null,
    kind: 'peer',
    provider: snapshot.provider,
    modelId: snapshot.selectedModel ?? record.modelId,
    threadId: snapshot.threadId ?? record.threadId,
    title: paneTitle(snapshot, record),
    preview: itemText(latest).slice(0, MAX_PEER_PREVIEW_CHARS),
    running: snapshot.activeTurnId !== null,
    activity: latest?.type === 'tool' ? latest.label : null,
    updatedAt
  }
}

export function subagentSummaries(parent: ChatPeerSummary, snapshot: ChatSnapshot): ChatPeerSummary[] {
  return snapshot.items.flatMap((item): ChatPeerSummary[] => {
    if (item.type !== 'tool' || !/subagent|collaboration/i.test(item.label)) return []
    return [{
      paneId: `${parent.paneId}:${item.id}`,
      parentPaneId: parent.paneId,
      kind: 'subagent',
      provider: parent.provider,
      modelId: parent.modelId,
      threadId: parent.threadId,
      title: item.label,
      preview: item.detail,
      running: /progress|running|started/i.test(item.status),
      activity: item.status,
      updatedAt: parent.updatedAt
    }]
  })
}

export function pageResult(summary: ChatPeerSummary, items: ChatSnapshot['items'], cursor: number, limit: number): PeerChatReadResult {
  const start = Math.max(0, Math.floor(cursor))
  const count = Math.min(100, Math.max(1, Math.floor(limit)))
  const page = items.slice(start, start + count)
  return { ...summary, items: page, nextCursor: start + page.length < items.length ? start + page.length : null }
}

export function itemText(item: ChatSnapshot['items'][number] | undefined): string {
  if (!item) return ''
  if (item.type === 'user' || item.type === 'assistant' || item.type === 'notice' || item.type === 'plan' || item.type === 'reasoning') return item.text
  if (item.type === 'tool') return item.detail || item.label
  if (item.type === 'command') return item.command
  return item.type === 'screenshot' ? item.caption : item.type === 'fileChange' ? `${item.changes.length} file changes` : ''
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}
