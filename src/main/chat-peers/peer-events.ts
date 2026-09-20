import type { ChatSnapshot } from '../../shared/chat.js'
import { activityPhase, CHAT_TURN_PAGE_SIZE } from '../../shared/chat.js'
import { tailTurnSlice } from '../../shared/chat-turn-page.js'
import type { ChatPeerSummary, ChatRowSummary, ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import type { CachedChatView } from '../chat-store/chat-transcript-cache.js'
import { summaryForRecord } from './peer-summary.js'

// What the workspace tells the renderer about its chats, and how often. Streaming emits one chat
// event per token chunk, and each one used to rebuild every pane's summary, send it across the
// bridge, and re-render the whole drawer. The throttle emits the first update straight away, then
// at most one per interval, and `flush` delivers a pending one instead of dropping it: the last
// update of a turn is the one that moves the row out of Current, so it must never be lost.

/** Floor between two `chats` updates while a turn streams. */
export const CHATS_EMIT_INTERVAL_MS = 200
/** Keep this below one 60 Hz frame; the renderer already applies the resulting events per frame. */
export const CHAT_IPC_BATCH_DELAY_MS = 8

export type RendererChatIpcMetrics = {
  paneId: string
  turnId: string
  receivedEvents: number
  sentEvents: number
  receivedDeltas: number
  sentDeltas: number
  deltaCharacters: number
}

export type RendererChatBatcher = ((event: ChatWorkspaceEvent) => void) & {
  flush(): void
  dispose(): void
}

/** Filter only the IPC delivery. Main-process observers and provider transcripts stay complete. */
export function rendererChatForwarder(
  selectedPaneId: string,
  send: (event: ChatWorkspaceEvent) => void
): (event: ChatWorkspaceEvent) => void {
  let visible = new Set([selectedPaneId])
  return (event) => {
    if (event.type === 'workspace') {
      selectedPaneId = event.snapshot.selectedPaneId
      visible = new Set(Object.keys(event.snapshot.panes ?? {}))
    }
    else if (event.type === 'chats') selectedPaneId = event.selectedPaneId
    else if (event.paneId !== selectedPaneId && !visible.has(event.paneId)) return
    send(event)
  }
}

/**
 * Coalesce adjacent transcript deltas immediately before IPC. Other events are ordering barriers:
 * a pending delta is sent before the event that follows it, so item completion, turn completion,
 * selection snapshots, and drawer state can never overtake streamed text.
 */
export function rendererChatBatcher(
  send: (event: ChatWorkspaceEvent) => void,
  onTurnMetrics: (metrics: RendererChatIpcMetrics) => void = () => {},
  delayMs = CHAT_IPC_BATCH_DELAY_MS
): RendererChatBatcher {
  let pending: Extract<ChatWorkspaceEvent, { type: 'pane' }> | null = null
  let timer: NodeJS.Timeout | null = null
  const turns = new Map<string, RendererChatIpcMetrics>()

  const countSent = (event: ChatWorkspaceEvent): void => {
    if (event.type !== 'pane') return
    const metrics = turns.get(event.paneId)
    if (!metrics) return
    metrics.sentEvents += 1
    if (event.event.type === 'itemDelta') metrics.sentDeltas += 1
  }

  const sendNow = (event: ChatWorkspaceEvent): void => {
    send(event)
    countSent(event)
  }

  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!pending) return
    const event = pending
    pending = null
    sendNow(event)
  }

  const batch = ((event: ChatWorkspaceEvent): void => {
    if (event.type === 'pane' && event.event.type === 'itemDelta') {
      const metrics = turns.get(event.paneId)
      if (metrics) {
        metrics.receivedEvents += 1
        metrics.receivedDeltas += 1
        metrics.deltaCharacters += event.event.delta.length
      }
      if (
        pending?.paneId === event.paneId &&
        pending.event.type === 'itemDelta' &&
        pending.event.itemId === event.event.itemId &&
        pending.event.field === event.event.field
      ) {
        pending = { ...pending, event: { ...pending.event, delta: pending.event.delta + event.event.delta } }
        return
      }
      flush()
      pending = event
      timer = setTimeout(flush, delayMs)
      timer.unref?.()
      return
    }

    flush()
    if (event.type !== 'pane') {
      sendNow(event)
      return
    }
    const inner = event.event
    if (inner.type === 'turn' && inner.turnId) {
      turns.set(event.paneId, {
        paneId: event.paneId,
        turnId: inner.turnId,
        receivedEvents: 0,
        sentEvents: 0,
        receivedDeltas: 0,
        sentDeltas: 0,
        deltaCharacters: 0
      })
    }
    const metrics = turns.get(event.paneId)
    if (metrics) metrics.receivedEvents += 1
    sendNow(event)
    if (inner.type === 'turn' && inner.turnId === null && metrics) {
      turns.delete(event.paneId)
      onTurnMetrics({ ...metrics })
    }
  }) as RendererChatBatcher

  batch.flush = flush
  batch.dispose = () => {
    flush()
    turns.clear()
  }
  return batch
}

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
    pinnedAt: record.pinnedAt,
    cwd: record.cwd,
    createdAt: record.createdAt,
    lastTurnEndedAt: record.lastTurnEndedAt
  }
}

/**
 * Show a pane whose provider has not replayed yet as the app last saw that chat. A parked,
 * detached, or just-relaunched pane snapshots empty, so opening one used to paint the "new chat"
 * layout — centred composer, no messages, no context reading — for the seconds a provider takes
 * to start and replay. The cached view stands in until the replay lands, and only while the chat
 * still holds the thread it was taken from, so a new chat or a provider switch shows nothing
 * stale. The context reading outlives the replay too: providers report it per turn, and a
 * resumed thread has none until the next one.
 */
export function cachedPaneView(
  snapshot: ChatSnapshot,
  record: ChatRecord | undefined,
  cached: CachedChatView | null
): ChatSnapshot {
  const threadId = snapshot.threadId ?? record?.threadId
  const checkpoint = record?.checkpoint && record.checkpoint.threadId === threadId
    ? record.checkpoint
    : snapshot.checkpoint
  if (!cached || !record?.threadId || cached.threadId !== record.threadId) {
    return checkpoint === snapshot.checkpoint ? snapshot : { ...snapshot, checkpoint }
  }
  const contextUsage = snapshot.contextUsage ?? cached.contextUsage
  if (snapshot.items.length > 0 || snapshot.activeTurnId) {
    const updated = contextUsage === snapshot.contextUsage ? snapshot : { ...snapshot, contextUsage }
    return checkpoint === updated.checkpoint ? updated : { ...updated, checkpoint }
  }
  return {
    ...snapshot,
    threadId: snapshot.threadId ?? record.threadId,
    threadName: snapshot.threadName ?? cached.threadName,
    contextUsage,
    ...(checkpoint ? { checkpoint } : {}),
    items: cached.items,
    history: { ...snapshot.history, hasEarlier: cached.hasEarlier }
  }
}

/**
 * What a peer reading this pane may see, and where it came from. A parked pane's snapshot is empty,
 * so a peer read a real conversation as empty (found 2026-09-04, after a restart left every pane
 * parked). The saved view the pane itself paints from stands in, reported as `saved` rather than
 * passed off as a full replay: it holds the newest items, and the chat reaches further back.
 */
export function readableView(
  live: ChatSnapshot,
  record: ChatRecord | undefined,
  cached: CachedChatView | null
): { snapshot: ChatSnapshot; source: 'live' | 'saved' } {
  if (live.items.length > 0) {
    const threadId = live.threadId ?? record?.threadId
    if (record?.checkpoint && record.checkpoint.threadId === threadId && live.checkpoint !== record.checkpoint) {
      return { snapshot: { ...live, checkpoint: record.checkpoint }, source: 'live' }
    }
    return { snapshot: live, source: 'live' }
  }
  const filled = cachedPaneView(live, record, cached)
  return { snapshot: filled, source: filled === live ? 'live' : 'saved' }
}

/** Emit active checkpoint updates when a chat record in the store changes. */
export function syncStoreCheckpoint<T extends { display: { current: { threadId: string | null } } }>(
  store: { get(id: string): ChatRecord | undefined },
  lifecycle: { get(id: string): T | undefined },
  ids: string[],
  emitPaneEvent: (peer: T, event: import('../../shared/chat.js').ChatEvent) => void
): void {
  for (const id of ids) {
    const peer = lifecycle.get(id)
    if (!peer) continue
    const record = store.get(id)
    const threadId = peer.display.current.threadId ?? record?.threadId
    const checkpoint = record?.checkpoint && record.checkpoint.threadId === threadId ? record.checkpoint : null
    emitPaneEvent(peer, { type: 'checkpoint', checkpoint })
  }
}

/** The renderer receives the active tail turn plus any live background work outside it. */
export function rendererSnapshot(snapshot: ChatSnapshot, title: string): ChatSnapshot {
  const slice = tailTurnSlice(snapshot.items, CHAT_TURN_PAGE_SIZE)
  let lastUser = snapshot.items.length - 1
  while (lastUser >= 0 && snapshot.items[lastUser]?.type !== 'user') lastUser -= 1
  const backgroundTasks = snapshot.history?.backgroundTasks ?? snapshot.items.slice(0, slice.start).filter((item, index) =>
    item.type === 'tool' && item.background && (index > lastUser || ['running', 'pending'].includes(activityPhase(item.status))))
  return {
    ...snapshot,
    items: snapshot.items.slice(slice.start),
    history: {
      hasEarlier: slice.hasEarlier || Boolean(snapshot.history?.hasEarlier),
      title,
      backgroundTasks
    }
  }
}
