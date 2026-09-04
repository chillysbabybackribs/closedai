import type { ChatSnapshot } from '../../shared/chat.js'
import { activityPhase, CHAT_HISTORY_PAGE_SIZE } from '../../shared/chat.js'
import type { ChatPeerSummary, ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import { summaryForRecord } from './peer-summary.js'

// What the workspace tells the renderer about its chats, and how often. Streaming emits one chat
// event per token chunk, and each one used to rebuild every pane's summary, send it across the
// bridge, and re-render the whole drawer. The throttle emits the first update straight away, then
// at most one per interval, and `flush` delivers a pending one instead of dropping it: the last
// update of a turn is the one that moves the row out of Current, so it must never be lost.

/** Floor between two `chats` updates while a turn streams. */
export const CHATS_EMIT_INTERVAL_MS = 200

export class PeerEmitThrottle {
  private timer: NodeJS.Timeout | null = null
  private pending = false

  constructor(private readonly emit: () => void, private readonly intervalMs = CHATS_EMIT_INTERVAL_MS) {}

  schedule(): void {
    if (this.timer) {
      this.pending = true
      return
    }
    this.emit()
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.pending) return
      this.pending = false
      this.schedule()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  /** Deliver a held update now; a no-op when nothing is pending. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.pending) return
    this.pending = false
    this.emit()
  }
}

/** A drawer row: the record's facts, overlaid with the live summary when the chat is attached. */
export function rowSummary(record: ChatRecord, live: ChatPeerSummary | null): ChatRowSummary {
  const base = live ?? summaryForRecord(record.id, record)
  return {
    ...base,
    paneId: record.id,
    threadId: base.threadId ?? record.threadId,
    // A live pane's snapshot can lag the record it just persisted; the newer of the two wins so
    // a chat never appears to travel back in time when it is attached.
    updatedAt: Math.max(base.updatedAt, record.updatedAt),
    attached: live !== null,
    cwd: record.cwd,
    createdAt: record.createdAt,
    lastTurnEndedAt: record.lastTurnEndedAt
  }
}

/** The renderer receives a bounded tail of the transcript plus what the earlier part held. */
export function rendererSnapshot(snapshot: ChatSnapshot, title: string): ChatSnapshot {
  const start = Math.max(0, snapshot.items.length - CHAT_HISTORY_PAGE_SIZE)
  let lastUser = snapshot.items.length - 1
  while (lastUser >= 0 && snapshot.items[lastUser]?.type !== 'user') lastUser -= 1
  const backgroundTasks = snapshot.history?.backgroundTasks ?? snapshot.items.slice(0, start).filter((item, index) =>
    item.type === 'tool' && item.background && (index > lastUser || ['running', 'pending'].includes(activityPhase(item.status))))
  return {
    ...snapshot,
    items: snapshot.items.slice(-CHAT_HISTORY_PAGE_SIZE),
    history: { hasEarlier: start > 0 || Boolean(snapshot.history?.hasEarlier), title, backgroundTasks }
  }
}
