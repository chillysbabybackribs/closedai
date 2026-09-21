import type { ChatEvent, ChatSnapshot } from '../../shared/chat.js'
import type { ChatPaneId, ChatPeerSummary } from '../../shared/chat-peers.js'
import { chatProviderOfId } from '../../shared/chat-providers.js'
import { chatRecordIsBlank, type ChatRecord, type ChatRecordPatch } from '../../shared/chat-store.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { traceLog } from '../trace/trace-log.js'
import type { PeerIdleParking, ParkablePeer } from './peer-idle-parking.js'
import { PeerSettings } from './peer-settings.js'
import { PLACEHOLDER_TITLE, PeerSummaryCache } from './peer-summary.js'
import { ChatTitles } from '../chat-titles/chat-titles.js'
import { titleRequest } from '../chat-titles/title-policy.js'

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
 * How many chats stay attached as panes. Pane-owned providers can hold a process, while Codex
 * holds a routed session on the workspace process. Nothing used to retire either kind, so every
 * chat ever started stayed in the workspace. Detaching keeps the record: the chat stays in the
 * drawer and reattaches when opened.
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
  private readonly titles: ChatTitles

  constructor(
    private readonly store: ChatStore,
    private readonly settings: AppSettingsAccess,
    private readonly createSurface: ChatPeerFactory,
    private readonly parking: PeerIdleParking,
    private readonly onEvent: (entry: PeerEntry, event: ChatEvent) => void,
    private readonly cancelPaneWork: (paneId: ChatPaneId) => void = () => {}
  ) {
    this.titles = new ChatTitles(store, (id) => {
      const entry = this.peers.get(id)
      if (entry) {
        const title = this.store.get(id)?.title ?? entry.display.current.title
        this.onEvent(entry, { type: 'title', title })
      }
    })
  }

  rename(chatId: ChatPaneId, title: string | null): void {
    const record = this.store.get(chatId)
    if (!record || record.archived) throw new Error('That chat is no longer available')
    this.titles.rename(chatId, title)
  }

  async retryTitle(chatId: ChatPaneId, withSurface: (fn: (surface: ChatSurface) => Promise<void>) => Promise<void>): Promise<void> {
    const record = this.store.get(chatId)
    if (!record || record.archived) throw new Error('That chat is no longer available')
    await withSurface(async (surface) => {
      if (!surface.generateTitle) throw new Error('Title generation is not supported for this provider')
      const snapshot = surface.snapshot()
      if (!titleRequest(snapshot)) throw new Error('Send a message first before generating a title')
      await this.titles.retry(chatId, snapshot, surface.generateTitle.bind(surface))
    })
  }

  /**
   * Attach the workspace's saved open chats, or a fresh one when it has none, and pick the
   * selection. Ids whose records are gone (archived, removed) are skipped rather than failing.
   */
  restoreOpenChats(
    openIds: string[],
    selectedId: string | null,
    modelId: string | null,
    effort: string | null,
    workspace: { cwd: string; projectPath: string | null }
  ): ChatPaneId {
    const { cwd, projectPath } = workspace
    const records = openIds.map((id) => this.store.get(id)).filter((record): record is ChatRecord =>
      record !== undefined && !record.archived)
    if (records.length === 0) {
      const saved = this.settings.get()
      const model = modelId ?? saved.chatModelId
      records.push(this.store.create({
        cwd, projectPath, provider: chatProviderOfId(model), modelId: model, reasoningEffort: effort ?? saved.chatReasoningEffort
      }))
    }
    for (const record of records) this.attach(record)
    return selectedId && records.some((record) => record.id === selectedId) ? selectedId : records[0]!.id
  }

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
      const wasRunning = entry.display.current.running
      const oldTitle = entry.display.current.title
      this.onEvent(entry, event)
      if (entry.display.current.title !== oldTitle) this.onEvent(entry, { type: 'title', title: entry.display.current.title })
      if (surface.generateTitle && (
        (event.type === 'item' && event.item.type === 'user') ||
        event.type === 'thread' ||
        (wasRunning && !entry.display.current.running)
      )) {
        void this.titles.generate(record.id, surface.snapshot(), surface.generateTitle.bind(surface))
      }
    })
    this.peers.set(record.id, entry)
    return entry
  }

  /** Rebuild one idle pane while retaining its identity and the old runtime until construction succeeds. */
  relocate(chatId: ChatPaneId, patch: ChatRecordPatch, source: ChatSnapshot): void {
    const previous = this.require(chatId)
    const record = this.store.require(chatId)
    this.parking.cancel(previous)
    this.titles.cancel(chatId)
    this.cancelPaneWork(chatId)
    this.peers.delete(chatId)
    try {
      const next = this.attach(this.store.update(chatId, patch))
      if (!next.surface.restoreConversation) throw new Error('This provider cannot move a conversation between directories')
      next.surface.restoreConversation(source)
      this.onEvent(next, { type: 'replace', snapshot: next.surface.snapshot() })
    } catch (error) {
      this.detach(chatId)
      this.store.update(chatId, record)
      this.peers.set(chatId, previous)
      this.parking.schedule(chatId)
      throw error
    }
    // Retire only this pane's old runtime. Its late events are ignored by the entry identity guard.
    if (previous.surface.dispose) previous.surface.dispose()
    else previous.surface.stop()
  }

  /** Stop the chat's runtime and forget its pane; the record stays. */
  detach(chatId: ChatPaneId): void {
    const entry = this.peers.get(chatId)
    if (!entry) return
    this.cancelPaneWork(chatId)
    this.titles.cancel(chatId)
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
   * A chat with nothing in it: no user submission, no user messages, no turn, no undelivered continuation, and
   * no open or wake in flight that could still bring any of those. The record is checked as well
   * as the snapshot because a parked pane's snapshot is empty whatever its chat holds.
   */
  isBlank(chatId: ChatPaneId): boolean {
    const record = this.store.get(chatId)
    if (!record || !chatRecordIsBlank(record) || record.continuation?.handoff) return false
    const entry = this.peers.get(chatId)
    if (!entry) return true
    if (entry.busy > 0 || entry.surface.hasRunningBackground?.()) return false
    const snapshot = entry.surface.snapshot({ limit: 1 })
    return !snapshot.items.some((item) => item.type === 'user') && !snapshot.activeTurnId
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
    const entry = this.peers.get(chatId)
    if (!entry) return false
    if (entry.surface.hasRunningBackground?.()) return true
    return entry.surface.snapshot({ limit: 0 }).activeTurnId != null
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
    const owned = record.titleSource === 'generated' || record.titleSource === 'manual'
    const title = owned || summary.title === PLACEHOLDER_TITLE ? record.title : summary.title
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
