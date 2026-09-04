import type { ChatEvent } from '../../shared/chat.js'
import type { ChatPaneId, ChatPeerSummary } from '../../shared/chat-peers.js'
import { chatRecordIsBlank, type ChatRecord } from '../../shared/chat-store.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { traceLog } from '../trace/trace-log.js'
import type { PeerIdleParking, ParkablePeer } from './peer-idle-parking.js'
import { PeerSettings } from './peer-settings.js'
import { PLACEHOLDER_TITLE, PeerSummaryCache } from './peer-summary.js'

// Which chats have a pane. Attaching builds a runtime for a record; detaching stops it and keeps
// the record, so a chat that leaves the workspace — retired past the cap, closed, or left behind
// by a relaunch — is still the same row in the drawer and reopens under the same id. Nothing here
// deletes a record except `discardIfBlank`, and that only for a chat that never became one.

export type ChatPeerFactory = (settings: PeerSettings, record: ChatRecord) => ChatSurface

export type PeerEntry = ParkablePeer & {
  chatId: ChatPaneId
  updatedAt: number
  display: PeerSummaryCache
  /** Operations in flight (an open, a wake). A chat with one is never judged blank or detached. */
  busy: number
}

/**
 * How many chats stay attached as panes. Each attached chat can hold a provider process, and
 * nothing used to retire one, so every chat ever started stayed in the workspace. Detaching keeps
 * the record: the chat stays in the drawer and reattaches when opened.
 */
export const MAX_ATTACHED_CHATS = 8

/**
 * How many unselected idle chats keep their runtime awake. Every chat the user leaves idles for
 * a grace period before parking, so starting new chats one after another stacked a provider
 * process per chat for five minutes each; past this many, the least recently active parks at
 * once when a chat is created or opened. Parking keeps the pane and the record; only the
 * process goes, and selecting the chat wakes it again.
 */
export const MAX_AWAKE_IDLE_CHATS = 2

export class PeerLifecycle {
  readonly peers = new Map<ChatPaneId, PeerEntry>()

  constructor(
    private readonly store: ChatStore,
    private readonly settings: AppSettingsAccess,
    private readonly createSurface: ChatPeerFactory,
    private readonly parking: PeerIdleParking,
    private readonly onEvent: (entry: PeerEntry, event: ChatEvent) => void
  ) {}

  get(chatId: ChatPaneId): PeerEntry | undefined {
    return this.peers.get(chatId)
  }

  require(chatId: ChatPaneId): PeerEntry {
    const entry = this.peers.get(chatId)
    if (!entry) throw new Error(`Unknown chat pane: ${chatId}`)
    return entry
  }

  ids(): ChatPaneId[] {
    return [...this.peers.keys()]
  }

  attach(record: ChatRecord): PeerEntry {
    const existing = this.peers.get(record.id)
    if (existing) return existing
    const surface = this.createSurface(new PeerSettings(this.settings, this.store, record.id), record)
    const entry: PeerEntry = {
      chatId: record.id,
      surface,
      updatedAt: record.updatedAt,
      idleTimer: null,
      parked: true,
      busy: 0,
      display: new PeerSummaryCache(record.id, () => this.store.get(record.id) ?? record)
    }
    surface.on('event', (event: ChatEvent) => {
      // A stopped provider can finish unwinding after a detach or project switch. Its last event
      // belongs to a pane that no longer exists and must not resurrect its summary.
      if (this.peers.get(record.id) !== entry) return
      this.onEvent(entry, event)
    })
    this.peers.set(record.id, entry)
    return entry
  }

  /** Stop the chat's runtime and forget its pane; the record stays. */
  detach(chatId: ChatPaneId): void {
    const entry = this.peers.get(chatId)
    if (!entry) return
    this.parking.cancel(entry)
    if (entry.surface.dispose) entry.surface.dispose()
    else entry.surface.stop()
    this.peers.delete(chatId)
    traceLog.responses.forget(chatId)
  }

  detachAll(): void {
    for (const chatId of this.ids()) this.detach(chatId)
  }

  /**
   * A chat with nothing in it: no thread, no messages, no turn, no undelivered continuation, and
   * no open or wake in flight that could still bring any of those. The record is checked as well
   * as the snapshot because a parked pane's snapshot is empty whatever its chat holds.
   */
  isBlank(chatId: ChatPaneId): boolean {
    const record = this.store.get(chatId)
    if (!record || !chatRecordIsBlank(record) || record.continuation?.handoff) return false
    const entry = this.peers.get(chatId)
    if (!entry) return true
    if (entry.busy > 0) return false
    const snapshot = entry.surface.snapshot({ limit: 1 })
    return snapshot.items.length === 0 && snapshot.threadId === null && !snapshot.activeTurnId
  }

  /** Drop a blank chat entirely: its pane and its record. Returns whether anything was removed. */
  discardIfBlank(chatId: ChatPaneId): boolean {
    if (this.store.get(chatId)?.pinnedAt != null) return false
    if (!this.isBlank(chatId)) return false
    this.detach(chatId)
    this.store.remove(chatId)
    return true
  }

  isRunning(chatId: ChatPaneId): boolean {
    return this.peers.get(chatId)?.surface.snapshot({ limit: 0 }).activeTurnId != null
  }

  /**
   * Detach the least recently active chats once more than the cap are attached. The chats in
   * `keep`, any chat mid-turn or mid-operation, and any chat still holding an undelivered
   * continuation digest are never detached: the first are in use and the last is state the
   * provider does not have yet. Returns the ids that were detached.
   */
  trim(keep: Iterable<ChatPaneId>, max = MAX_ATTACHED_CHATS): ChatPaneId[] {
    const excess = this.peers.size - max
    if (excess <= 0) return []
    const pinned = new Set(keep)
    for (const [chatId, entry] of this.peers) {
      if (entry.busy > 0 || this.isRunning(chatId) || this.store.get(chatId)?.continuation?.handoff) pinned.add(chatId)
    }
    const detaching = [...this.peers.values()]
      .filter((entry) => !pinned.has(entry.chatId))
      .sort((a, b) => this.lastActivity(a) - this.lastActivity(b))
      .slice(0, excess)
      .map((entry) => entry.chatId)
    for (const chatId of detaching) this.detach(chatId)
    return detaching
  }

  /**
   * Park the runtimes of idle, unselected chats beyond the awake budget, oldest activity first.
   * A running turn, an operation in flight, or an already parked chat is left alone. Returns the
   * ids that were parked.
   */
  parkExcessIdle(selected: ChatPaneId, max = MAX_AWAKE_IDLE_CHATS): ChatPaneId[] {
    const idle = [...this.peers.values()].filter((entry) =>
      entry.chatId !== selected && !entry.parked && entry.busy === 0 && !this.isRunning(entry.chatId))
    if (idle.length <= max) return []
    const parking = idle.sort((a, b) => this.lastActivity(a) - this.lastActivity(b)).slice(0, idle.length - max)
    for (const entry of parking) this.parking.stop(entry)
    return parking.map((entry) => entry.chatId)
  }

  private lastActivity(entry: PeerEntry): number {
    return Math.max(entry.updatedAt, this.store.get(entry.chatId)?.updatedAt ?? 0)
  }

  /** Track an operation on a chat so blank checks and trimming leave it alone until it lands. */
  async withBusy<T>(chatId: ChatPaneId, action: () => Promise<T>): Promise<T> {
    const entry = this.peers.get(chatId)
    if (entry) entry.busy += 1
    try {
      return await action()
    } finally {
      if (entry) entry.busy = Math.max(0, entry.busy - 1)
    }
  }

  /**
   * Keep the record's title, preview, and activity time current so the drawer names a detached
   * or parked chat and a relaunch finds it the same. Titles change rarely and turn boundaries
   * twice per turn, so this never writes on a streaming delta. A placeholder title never
   * overwrites a saved one: a wake replays through an empty snapshot before the thread lands,
   * and persisting that moment renamed every reopened chat to "New chat".
   */
  rememberDisplay(chatId: ChatPaneId, summary: ChatPeerSummary, updatedAt: number, turnEnded: boolean | null): void {
    const record = this.store.get(chatId)
    if (!record) return
    const title = summary.title === PLACEHOLDER_TITLE ? record.title : summary.title
    const preview = summary.preview || record.preview
    const changed = title !== record.title || preview !== record.preview || turnEnded !== null
    if (!changed) return
    this.store.update(chatId, {
      title,
      preview,
      updatedAt: Math.max(record.updatedAt, updatedAt),
      ...(turnEnded ? { lastTurnEndedAt: updatedAt } : {})
    })
  }
}
