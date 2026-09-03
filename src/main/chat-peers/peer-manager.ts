import { EventEmitter } from 'node:events'
import type { ChatAttachment, ChatEvent, ChatSnapshot, ChatThreadSummary } from '../../shared/chat.js'
import { activityPhase, CHAT_HISTORY_PAGE_SIZE, type ChatHistoryPage, type ChatHistoryWindow } from '../../shared/chat.js'
import type {
  ChatContinuationSource,
  ChatPaneId,
  ChatPeerSummary,
  ChatWorkspaceEvent,
  ChatWorkspaceSnapshot,
  PeerChatReadResult
} from '../../shared/chat-peers.js'
import { chatProviderOfId } from '../../shared/chat-providers.js'
import type { ChatContinuation, ChatPeerRecord } from '../../shared/types.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { buildThreadHandoff } from '../chat-context/thread-handoff.js'
import { PeerIdleParking, type ParkablePeer } from './peer-idle-parking.js'
import { PeerSettings } from './peer-settings.js'
import { traceLog } from '../trace/trace-log.js'
import {
  PLACEHOLDER_TITLE,
  PeerSummaryCache,
  pageResult,
  subagentSummaries
} from './peer-summary.js'

export type ChatPeerFactory = (settings: PeerSettings, modelId: string | null) => ChatSurface

export type ChatWorkspaceSelection = {
  cwd: string
  projectPath: string | null
}

export type ChatWorkspaceSelector = {
  current(): ChatWorkspaceSelection
  select(projectPath: string | null, preference: { modelId: string | null; reasoningEffort: string | null }): Promise<void>
}

export interface ChatWorkspaceSurface {
  snapshot(window?: ChatHistoryWindow): ChatWorkspaceSnapshot
  readHistoryPage(paneId: ChatPaneId, threadId: string | null, beforeItemId: string): ChatHistoryPage
  start(): Promise<void>
  stop(): void
  send(paneId: ChatPaneId, text: string, attachments: ChatAttachment[]): Promise<void>
  interrupt(paneId: ChatPaneId): Promise<void>
  selectPane(paneId: ChatPaneId): Promise<void>
  selectModel(paneId: ChatPaneId, modelId: string): Promise<void>
  selectReasoningEffort(paneId: ChatPaneId, effort: string): Promise<void>
  refreshPlanUsage(paneId: ChatPaneId): Promise<void>
  listThreads(): Promise<ChatThreadSummary[]>
  newPeer(): Promise<ChatPaneId>
  closePeer(paneId: ChatPaneId): Promise<void>
  continueInNewPeer(source: ChatContinuationSource, modelId: string | null): Promise<ChatPaneId>
  openThread(paneId: ChatPaneId, threadId: string): Promise<void>
  archiveThread(threadId: string): Promise<void>
  selectProject(projectPath: string | null): Promise<void>
  beginLogin(): Promise<string | null>
  on(event: 'event', listener: (event: ChatWorkspaceEvent) => void): unknown
}

type PeerEntry = ParkablePeer & {
  updatedAt: number
  display: PeerSummaryCache
}

/**
 * How many chats stay open as panes. Nothing used to retire a pane, so every chat ever started
 * stayed in the workspace — 22 of them here — and the drawer listed all of them as open work.
 * Retiring a pane keeps its thread: it reopens from History, in a fresh pane.
 */
const MAX_OPEN_PANES = 8

/** Floor between two `peers` updates while a turn streams. */
const PEERS_EMIT_INTERVAL_MS = 200

/** How long the thread catalog is reused before the providers are scanned again. */
const THREADS_CACHE_MS = 5_000

export class ChatPeerManager extends EventEmitter implements ChatWorkspaceSurface {
  private readonly peers = new Map<ChatPaneId, PeerEntry>()
  private selectedPaneId: ChatPaneId
  private readonly parking: PeerIdleParking
  /** Tail of each pane's operation chain, so callers on one pane cannot interleave. */
  private readonly paneOperations = new Map<ChatPaneId, Promise<void>>()
  private peersTimer: NodeJS.Timeout | null = null
  private peersPending = false
  private threads: { at: number; list: ChatThreadSummary[] } | null = null
  private threadsInFlight: Promise<ChatThreadSummary[]> | null = null

  constructor(
    private readonly settings: AppSettingsAccess,
    private readonly createSurface: ChatPeerFactory,
    idleParkMs?: number,
    private readonly workspaceSelector?: ChatWorkspaceSelector
  ) {
    super()
    const saved = settings.get()
    const records = saved.chatPeers.length > 0
      ? saved.chatPeers
      : [freshRecord(saved.chatModelId, saved.chatReasoningEffort)]
    this.selectedPaneId = saved.chatSelectedPaneId ?? records[0]!.paneId
    this.parking = new PeerIdleParking((paneId) => this.peers.get(paneId), () => this.selectedPaneId, idleParkMs)
    for (const record of records) this.attach(record)
    if (saved.chatPeers.length === 0) {
      void settings.set({ chatPeers: records, chatSelectedPaneId: this.selectedPaneId })
    }
  }

  snapshot(window?: ChatHistoryWindow): ChatWorkspaceSnapshot {
    const entry = this.requirePeer(this.selectedPaneId)
    const selected = entry.surface.snapshot(window)
    return {
      selectedPaneId: this.selectedPaneId,
      peers: this.peerSummaries(),
      selected: window ? rendererSnapshot(selected, entry.display.current.title) : selected,
      workspace: this.workspaceSelector?.current()
    }
  }

  readHistoryPage(paneId: ChatPaneId, threadId: string | null, beforeItemId: string): ChatHistoryPage {
    if (typeof beforeItemId !== 'string' || !beforeItemId) throw new Error('Choose a history cursor')
    const snapshot = this.requirePeer(paneId).surface.snapshot({ beforeItemId, limit: CHAT_HISTORY_PAGE_SIZE })
    if (snapshot.threadId !== threadId) throw new Error('The chat changed while loading history')
    return { items: snapshot.items, hasEarlier: snapshot.history?.hasEarlier ?? false }
  }

  /** One pane's live snapshot without waking a parked peer; null for an unknown pane. */
  paneSnapshot(paneId: ChatPaneId): ChatSnapshot | null {
    return this.peers.get(paneId)?.surface.snapshot() ?? null
  }

  async start(): Promise<void> {
    // Persisted panes are history, not live work. Warming every one creates an app-server per
    // pane after each relaunch; the selected pane is the only surface startup needs immediately.
    await this.parking.wake(this.selectedPaneId)
    await this.retireExcessPanes()
  }

  stop(): void {
    if (this.peersTimer) clearTimeout(this.peersTimer)
    this.peersTimer = null
    this.peersPending = false
    for (const [paneId, entry] of this.peers) {
      this.parking.stop(entry)
      traceLog.responses.forget(paneId)
    }
  }

  async send(paneId: ChatPaneId, text: string, attachments: ChatAttachment[]): Promise<void> {
    const entry = this.requirePeer(paneId)
    const cancelTiming = text.trim() || attachments.length
      ? traceLog.responses.begin({ paneId, provider: entry.display.current.provider, turnId: null })
      : null
    try {
      await this.withAwake(paneId, (surface) => surface.send(text, attachments))
    } catch (error) {
      cancelTiming?.()
      throw error
    }
  }

  async interrupt(paneId: ChatPaneId): Promise<void> {
    await this.withAwake(paneId, (surface) => surface.interrupt())
  }

  async selectPane(paneId: ChatPaneId): Promise<void> {
    this.requirePeer(paneId)
    if (paneId === this.selectedPaneId) return

    const previousPaneId = this.selectedPaneId
    const currentEntry = this.peers.get(previousPaneId)
    const currentSnapshot = currentEntry?.surface.snapshot({ limit: 1 })
    const currentEmpty = currentSnapshot &&
      currentSnapshot.items.length === 0 &&
      currentSnapshot.threadId === null &&
      !currentSnapshot.activeTurnId &&
      !this.record(previousPaneId).continuation?.handoff

    const discardEmptyPane = currentEmpty && currentEntry && this.peers.size > 1
    if (discardEmptyPane) {
      currentEntry.surface.stop()
      this.parking.cancel(currentEntry)
      this.peers.delete(previousPaneId)
      traceLog.responses.forget(previousPaneId)
    }

    this.selectedPaneId = paneId
    this.parking.schedule(previousPaneId)
    // Paint the destination from the snapshot it already holds before its runtime is back.
    // Waking replays the thread from the provider's store and starts a CLI process; awaiting
    // that here kept the pane on the previous chat for the whole start-up, which is what made
    // switching chats feel stuck. The wake emits its own `replace` when it lands.
    this.emitWorkspace()
    const settings = this.settings.get()
    await this.settings.set({
      chatSelectedPaneId: paneId,
      ...(discardEmptyPane
        ? { chatPeers: settings.chatPeers.filter((peer) => peer.paneId !== previousPaneId) }
        : {})
    })
    void this.parking.wake(paneId).catch((error: unknown) => {
      console.warn('[chat-peers] could not wake pane:', error instanceof Error ? error.message : String(error))
    })
  }

  /** Read the pane's provider plan usage now; the hover card asks each time it opens. */
  async refreshPlanUsage(paneId: ChatPaneId): Promise<void> {
    await this.withAwake(paneId, (surface) => surface.refreshPlanUsage())
  }

  async selectModel(paneId: ChatPaneId, modelId: string): Promise<void> {
    await this.withAwake(paneId, (surface) => surface.selectModel(modelId))
  }

  async selectReasoningEffort(paneId: ChatPaneId, effort: string): Promise<void> {
    await this.withAwake(paneId, (surface) => surface.selectReasoningEffort(effort))
  }

  async listThreads(): Promise<ChatThreadSummary[]> {
    // Thread history is workspace-wide, so every pane returns the same catalog. Querying each
    // persisted pane needlessly wakes all of their provider runtimes during the drawer's mount.
    //
    // The scan reads every session each provider has stored — seconds of main-process work on a
    // busy workspace — and the drawer asks for it again on every chat switch. Callers within the
    // window share one answer, and a request in flight is joined rather than started twice.
    const fresh = this.threads && Date.now() - this.threads.at < THREADS_CACHE_MS ? this.threads.list : null
    if (fresh) return fresh
    this.threadsInFlight ??= this.withAwake(this.selectedPaneId, (surface) => surface.listThreads())
      .then((list) => {
        this.threads = { at: Date.now(), list }
        return list
      })
      .finally(() => { this.threadsInFlight = null })
    return this.threadsInFlight
  }

  async newPeer(): Promise<ChatPaneId> {
    const previousPaneId = this.selectedPaneId
    const current = this.requirePeer(previousPaneId).surface.snapshot({ limit: 0 })
    const record = freshRecord(current.selectedModel, current.selectedReasoningEffort)
    const settings = this.settings.get()
    await this.settings.set({
      chatPeers: [...settings.chatPeers, record],
      chatSelectedPaneId: record.paneId
    })
    this.attach(record)
    this.selectedPaneId = record.paneId
    this.parking.schedule(previousPaneId)
    await this.retireExcessPanes()
    this.emitWorkspace()
    void this.parking.wake(record.paneId)
    return record.paneId
  }

  /**
   * Close the least recently active panes once the workspace holds more than it should. The
   * selected pane, any pane mid-turn, and any pane still holding an undelivered continuation
   * digest are never retired — the first two are in use and the last is state stored nowhere else.
   */
  private async retireExcessPanes(): Promise<void> {
    const records = this.settings.get().chatPeers
    const excess = records.length - MAX_OPEN_PANES
    if (excess <= 0) return

    const keep = new Set<ChatPaneId>([this.selectedPaneId])
    for (const [paneId, entry] of this.peers) {
      if (entry.surface.snapshot({ limit: 0 }).activeTurnId) keep.add(paneId)
    }
    for (const record of records) {
      if (record.continuation?.handoff) keep.add(record.paneId)
    }

    const retiring = new Set(
      records
        .map((record, index) => ({ record, index }))
        .filter(({ record }) => !keep.has(record.paneId))
        // Oldest activity first; records saved before panes tracked a time fall back to their
        // creation order, which is the order they were appended to settings.
        .sort((a, b) => (a.record.updatedAt ?? 0) - (b.record.updatedAt ?? 0) || a.index - b.index)
        .slice(0, excess)
        .map(({ record }) => record.paneId)
    )
    if (retiring.size === 0) return

    for (const paneId of retiring) {
      const entry = this.peers.get(paneId)
      if (!entry) continue
      this.parking.stop(entry)
      this.peers.delete(paneId)
      traceLog.responses.forget(paneId)
    }
    await this.settings.set({
      chatPeers: this.settings.get().chatPeers.filter((record) => !retiring.has(record.paneId))
    })
  }

  async closePeer(paneId: ChatPaneId): Promise<void> {
    const entry = this.peers.get(paneId)
    if (!entry) return
    this.parking.stop(entry)
    this.peers.delete(paneId)
    traceLog.responses.forget(paneId)
    const settings = this.settings.get()
    const remaining = settings.chatPeers.filter((record) => record.paneId !== paneId)
    if (remaining.length === 0) {
      const fresh = freshRecord(null, null)
      remaining.push(fresh)
      this.attach(fresh)
      this.selectedPaneId = fresh.paneId
    } else if (this.selectedPaneId === paneId) {
      this.selectedPaneId = remaining[0]!.paneId
    }
    await this.settings.set({
      chatPeers: remaining,
      chatSelectedPaneId: this.selectedPaneId
    })
    await this.parking.wake(this.selectedPaneId)
    this.emitWorkspace()
  }

  async continueInNewPeer(source: ChatContinuationSource, modelId: string | null): Promise<ChatPaneId> {
    if (!source?.paneId && !source?.threadId) throw new Error('Choose a chat to continue')
    const previousPaneId = this.selectedPaneId
    const current = this.requirePeer(previousPaneId).surface.snapshot()
    let sourceSnapshot: ChatSnapshot | null = null
    let sourceThreadId = source.threadId
    let sourceProvider = sourceThreadId ? chatProviderOfId(sourceThreadId) : current.provider
    let items: ChatSnapshot['items']
    let threadName: string | null

    if (source.paneId) {
      sourceSnapshot = await this.withAwake(source.paneId, async (surface) => surface.snapshot())
      if (sourceSnapshot.activeTurnId) throw new Error('Stop the current turn before continuing in a new chat')
      sourceThreadId = sourceSnapshot.threadId ?? sourceThreadId
      sourceProvider = sourceSnapshot.provider
      items = sourceSnapshot.items
      threadName = sourceSnapshot.threadName
    } else {
      const content = await this.withAwake(previousPaneId, (surface) => surface.readThread(sourceThreadId!))
      sourceThreadId = content.threadId
      sourceProvider = chatProviderOfId(content.threadId)
      items = content.items
      threadName = content.threadName
    }

    if (source.throughItemId) {
      const index = items.findIndex((item) => item.id === source.throughItemId)
      const endpoint = items[index]
      if (!endpoint || endpoint.type !== 'assistant' || endpoint.streaming) {
        throw new Error('Choose a completed response to branch from')
      }
      items = items.slice(0, index + 1)
    }
    const handoff = buildThreadHandoff(items, threadName)
    if (!handoff) throw new Error('There is no conversation to continue yet')
    const targetModel = modelId ?? sourceSnapshot?.selectedModel ?? current.selectedModel
    const targetEffort = targetModel === sourceSnapshot?.selectedModel
      ? sourceSnapshot?.selectedReasoningEffort ?? null
      : targetModel === current.selectedModel ? current.selectedReasoningEffort : null
    const continuation: ChatContinuation = {
      sourcePaneId: source.paneId,
      sourceThreadId,
      sourceProvider,
      sourceTitle: handoff.title,
      handoff: handoff.text,
      createdAt: Date.now()
    }
    const record = freshRecord(targetModel, targetEffort, continuation)
    const settings = this.settings.get()
    await this.settings.set({
      chatPeers: [...settings.chatPeers, record],
      chatSelectedPaneId: record.paneId
    })
    this.attach(record)
    this.selectedPaneId = record.paneId
    this.parking.schedule(previousPaneId)
    this.emitWorkspace()
    void this.parking.wake(record.paneId)
    return record.paneId
  }

  async openThread(paneId: ChatPaneId, threadId: string): Promise<void> {
    await this.withAwake(paneId, (surface) => surface.openThread(threadId))
  }

  async archiveThread(threadId: string): Promise<void> {
    const matching = [...this.peers].find(([, entry]) => entry.surface.snapshot({ limit: 0 }).threadId === threadId)
    const paneId = matching?.[0] ?? this.selectedPaneId
    await this.withAwake(paneId, (surface) => surface.archiveThread(threadId))
    // The drawer refreshes right after this; it must not be handed the list with the row still in it.
    this.threads = null
  }

  /** A provider process cannot safely change directories mid-turn. Swap the active pane set
   * only after its project-scoped state has been persisted and the destination restored. */
  async selectProject(projectPath: string | null): Promise<void> {
    if (!this.workspaceSelector) throw new Error('Project selection is unavailable')
    if ([...this.peers.values()].some((entry) => entry.surface.snapshot({ limit: 0 }).activeTurnId)) {
      throw new Error('Stop running chats before changing projects')
    }
    const current = this.requirePeer(this.selectedPaneId).surface.snapshot({ limit: 0 })
    const selection = this.workspaceSelector.current()
    if (selection.projectPath === projectPath) return

    for (const [paneId, entry] of this.peers) {
      this.parking.stop(entry)
      traceLog.responses.forget(paneId)
    }
    this.peers.clear()
    await this.workspaceSelector.select(projectPath, {
      modelId: current.selectedModel,
      reasoningEffort: current.selectedReasoningEffort
    })

    const restored = this.settings.get()
    const records = restored.chatPeers.length > 0
      ? restored.chatPeers
      : [freshRecord(current.selectedModel, current.selectedReasoningEffort)]
    this.selectedPaneId = restored.chatSelectedPaneId && records.some((record) => record.paneId === restored.chatSelectedPaneId)
      ? restored.chatSelectedPaneId
      : records[0]!.paneId
    if (restored.chatPeers.length === 0) {
      await this.settings.set({ chatPeers: records, chatSelectedPaneId: this.selectedPaneId })
    }
    for (const record of records) this.attach(record)
    this.emitWorkspace()
    void this.parking.wake(this.selectedPaneId)
  }

  beginLogin(): Promise<string | null> {
    return this.withAwake(this.selectedPaneId, (surface) => surface.beginLogin())
  }

  listReadable(callerPaneId: string | null): ChatPeerSummary[] {
    return this.peerSummaries().flatMap((peer) => [
      ...(peer.paneId === callerPaneId ? [] : [peer]),
      ...subagentSummaries(peer, this.requirePeer(peer.paneId).surface.snapshot())
    ])
  }

  readReadable(chatId: string, callerPaneId: string | null, cursor = 0, limit = 50): PeerChatReadResult | null {
    const direct = this.peerSummaries().find((peer) => peer.paneId === chatId && peer.paneId !== callerPaneId)
    if (direct) return pageResult(direct, this.requirePeer(chatId).surface.snapshot().items, cursor, limit)
    for (const peer of this.peerSummaries()) {
      const snapshot = this.requirePeer(peer.paneId).surface.snapshot()
      const subagent = subagentSummaries(peer, snapshot).find((entry) => entry.paneId === chatId)
      if (subagent) {
        const itemId = chatId.slice(peer.paneId.length + 1)
        return pageResult(subagent, snapshot.items.filter((item) => item.id === itemId), cursor, limit)
      }
    }
    return null
  }

  private attach(record: ChatPeerRecord): PeerEntry {
    const surface = this.createSurface(new PeerSettings(this.settings, record.paneId), record.modelId)
    const entry: PeerEntry = {
      surface,
      updatedAt: record.updatedAt ?? 0,
      idleTimer: null,
      parked: true,
      display: new PeerSummaryCache(record.paneId, record)
    }
    surface.on('event', (event: ChatEvent) => {
      // A stopped provider can finish unwinding after a project switch. Its last event belongs
      // to the retired workspace and must not look up a record that has already been discarded.
      if (this.peers.get(record.paneId) !== entry) return
      traceLog.responses.event(record.paneId, event)
      entry.updatedAt = Date.now()
      const oldTitle = entry.display.current.title
      entry.display.update(event, entry.updatedAt)
      const rendererEvent = event.type === 'replace'
        ? { ...event, snapshot: rendererSnapshot(event.snapshot, entry.display.current.title) }
        : event
      this.emit('event', { type: 'pane', paneId: record.paneId, event: rendererEvent } satisfies ChatWorkspaceEvent)
      this.schedulePeers()
      if (event.type === 'turn' || entry.display.current.title !== oldTitle) {
        void this.rememberDisplay(record.paneId, entry.display.current, entry.updatedAt, event.type === 'turn')
      }
      if (entry.display.current.running) this.parking.cancel(entry)
      else this.parking.schedule(record.paneId)
    })
    this.peers.set(record.paneId, entry)
    return entry
  }

  /**
   * Keep the record's title and activity time current so the drawer names a parked pane after a
   * relaunch. Titles change rarely (first message, provider naming) and turn boundaries twice per
   * turn, so this never writes settings on a streaming delta.
   */
  private async rememberDisplay(paneId: ChatPaneId, summary: ChatPeerSummary, updatedAt: number, turnBoundary: boolean): Promise<void> {
    const settings = this.settings.get()
    const record = settings.chatPeers.find((peer) => peer.paneId === paneId)
    if (!record) return
    const title = summary.title
    const titleChanged = title !== PLACEHOLDER_TITLE && title !== (record.title ?? null)
    if (!titleChanged && !turnBoundary) return
    const updated: ChatPeerRecord = { ...record, title: titleChanged ? title : record.title ?? null, updatedAt }
    try {
      await this.settings.set({
        chatPeers: settings.chatPeers.map((peer) => (peer.paneId === paneId ? updated : peer))
      })
    } catch (error) {
      console.warn('[chat-peers] could not persist pane title:', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * One pane runs one operation at a time. Waking is asynchronous, so two callers could
   * otherwise interleave: a model switch landing between another caller's wake and its send
   * moves the pane to a different provider, and the send starts its turn on the surface the
   * pane just left — invisibly, because the pane now reports on a surface with no turn.
   */
  private async withAwake<T>(paneId: ChatPaneId, action: (surface: ChatSurface) => Promise<T>): Promise<T> {
    const queued = (this.paneOperations.get(paneId) ?? Promise.resolve()).then(async () => {
      const entry = await this.parking.wake(paneId)
      this.parking.cancel(entry)
      try {
        return await action(entry.surface)
      } finally {
        this.parking.schedule(paneId)
      }
    })
    // A failed operation must not cancel the ones behind it, so the chain swallows its result.
    const tail = queued.then(() => undefined, () => undefined)
    this.paneOperations.set(paneId, tail)
    try {
      return await queued
    } finally {
      if (this.paneOperations.get(paneId) === tail) this.paneOperations.delete(paneId)
    }
  }

  private requirePeer(paneId: ChatPaneId): PeerEntry {
    const peer = this.peers.get(paneId)
    if (!peer) throw new Error(`Unknown chat pane: ${paneId}`)
    return peer
  }

  private record(paneId: ChatPaneId): ChatPeerRecord {
    const record = this.settings.get().chatPeers.find((peer) => peer.paneId === paneId)
    if (!record) throw new Error(`Unknown chat pane: ${paneId}`)
    return record
  }

  private peerSummaries(): ChatPeerSummary[] {
    return [...this.peers.values()].map((entry) => ({ ...entry.display.current }))
  }

  private emitWorkspace(): void {
    this.emit('event', { type: 'workspace', snapshot: this.snapshot({ limit: CHAT_HISTORY_PAGE_SIZE }) } satisfies ChatWorkspaceEvent)
  }

  private emitPeers(): void {
    this.emit('event', {
      type: 'peers',
      selectedPaneId: this.selectedPaneId,
      peers: this.peerSummaries()
    } satisfies ChatWorkspaceEvent)
  }

  /**
   * Peer summaries are drawer decoration — a title, a preview line, a running dot. Streaming
   * emits one chat event per token chunk, and each one rebuilt every pane's summary, sent it
   * across the bridge, and re-rendered the whole drawer. Emit the first one straight away, then
   * at most one per interval, so a running turn cannot starve the panes the user is working in.
   */
  private schedulePeers(): void {
    if (this.peersTimer) {
      this.peersPending = true
      return
    }
    this.emitPeers()
    this.peersTimer = setTimeout(() => {
      this.peersTimer = null
      if (!this.peersPending) return
      this.peersPending = false
      this.schedulePeers()
    }, PEERS_EMIT_INTERVAL_MS)
    this.peersTimer.unref?.()
  }
}

function freshRecord(
  modelId: string | null,
  reasoningEffort: string | null,
  continuation: ChatContinuation | null = null
): ChatPeerRecord {
  return {
    paneId: crypto.randomUUID(),
    provider: chatProviderOfId(modelId),
    threadId: null,
    codexThreadId: null,
    claudeSessionId: null,
    modelId,
    reasoningEffort,
    continuation,
    updatedAt: Date.now()
  }
}

function rendererSnapshot(snapshot: ChatSnapshot, title: string): ChatSnapshot {
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
