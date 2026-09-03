import { EventEmitter } from 'node:events'
import type { ChatAttachment, ChatEvent, ChatSnapshot, ChatThreadSummary } from '../../shared/chat.js'
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

export type ChatPeerFactory = (settings: PeerSettings, modelId: string | null) => ChatSurface

export interface ChatWorkspaceSurface {
  snapshot(): ChatWorkspaceSnapshot
  start(): Promise<void>
  stop(): void
  send(paneId: ChatPaneId, text: string, attachments: ChatAttachment[]): Promise<void>
  interrupt(paneId: ChatPaneId): Promise<void>
  selectPane(paneId: ChatPaneId): Promise<void>
  selectModel(paneId: ChatPaneId, modelId: string): Promise<void>
  selectReasoningEffort(paneId: ChatPaneId, effort: string): Promise<void>
  listThreads(): Promise<ChatThreadSummary[]>
  newPeer(): Promise<ChatPaneId>
  closePeer(paneId: ChatPaneId): Promise<void>
  continueInNewPeer(source: ChatContinuationSource, modelId: string | null): Promise<ChatPaneId>
  openThread(paneId: ChatPaneId, threadId: string): Promise<void>
  archiveThread(threadId: string): Promise<void>
  beginLogin(): Promise<string | null>
  on(event: 'event', listener: (event: ChatWorkspaceEvent) => void): unknown
}

type PeerEntry = ParkablePeer & {
  updatedAt: number
}

export class ChatPeerManager extends EventEmitter implements ChatWorkspaceSurface {
  private readonly peers = new Map<ChatPaneId, PeerEntry>()
  private selectedPaneId: ChatPaneId
  private readonly parking: PeerIdleParking

  constructor(
    private readonly settings: AppSettingsAccess,
    private readonly createSurface: ChatPeerFactory,
    idleParkMs?: number
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

  snapshot(): ChatWorkspaceSnapshot {
    return {
      selectedPaneId: this.selectedPaneId,
      peers: this.peerSummaries(),
      selected: this.requirePeer(this.selectedPaneId).surface.snapshot()
    }
  }

  /** One pane's live snapshot without waking a parked peer; null for an unknown pane. */
  paneSnapshot(paneId: ChatPaneId): ChatSnapshot | null {
    return this.peers.get(paneId)?.surface.snapshot() ?? null
  }

  async start(): Promise<void> {
    // Persisted panes are history, not live work. Warming every one creates an app-server per
    // pane after each relaunch; the selected pane is the only surface startup needs immediately.
    await this.parking.wake(this.selectedPaneId)
  }

  stop(): void {
    for (const entry of this.peers.values()) {
      this.parking.stop(entry)
    }
  }

  async send(paneId: ChatPaneId, text: string, attachments: ChatAttachment[]): Promise<void> {
    await this.withAwake(paneId, (surface) => surface.send(text, attachments))
  }

  async interrupt(paneId: ChatPaneId): Promise<void> {
    await this.withAwake(paneId, (surface) => surface.interrupt())
  }

  async selectPane(paneId: ChatPaneId): Promise<void> {
    this.requirePeer(paneId)
    if (paneId === this.selectedPaneId) return

    const previousPaneId = this.selectedPaneId
    const currentEntry = this.peers.get(previousPaneId)
    const currentSnapshot = currentEntry?.surface.snapshot()
    const currentEmpty = currentSnapshot &&
      currentSnapshot.items.length === 0 &&
      currentSnapshot.threadId === null &&
      !currentSnapshot.activeTurnId &&
      !this.record(previousPaneId).continuation?.handoff

    if (currentEmpty && currentEntry && this.peers.size > 1) {
      currentEntry.surface.stop()
      this.parking.cancel(currentEntry)
      this.peers.delete(previousPaneId)
      const settings = this.settings.get()
      await this.settings.set({
        chatPeers: settings.chatPeers.filter((p) => p.paneId !== previousPaneId)
      })
    }

    this.selectedPaneId = paneId
    await this.settings.set({ chatSelectedPaneId: paneId })
    this.parking.schedule(previousPaneId)
    await this.parking.wake(paneId)
    this.emitWorkspace()
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
    return this.withAwake(this.selectedPaneId, (surface) => surface.listThreads())
  }

  async newPeer(): Promise<ChatPaneId> {
    const previousPaneId = this.selectedPaneId
    const current = this.requirePeer(previousPaneId).surface.snapshot()
    const record = freshRecord(current.selectedModel, current.selectedReasoningEffort)
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

  async closePeer(paneId: ChatPaneId): Promise<void> {
    const entry = this.peers.get(paneId)
    if (!entry) return
    this.parking.stop(entry)
    this.peers.delete(paneId)
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
    const matching = [...this.peers].find(([, entry]) => entry.surface.snapshot().threadId === threadId)
    const paneId = matching?.[0] ?? this.selectedPaneId
    await this.withAwake(paneId, (surface) => surface.archiveThread(threadId))
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
    const entry: PeerEntry = { surface, updatedAt: Date.now(), idleTimer: null, parked: true }
    surface.on('event', (event: ChatEvent) => {
      entry.updatedAt = Date.now()
      this.emit('event', { type: 'pane', paneId: record.paneId, event } satisfies ChatWorkspaceEvent)
      this.emitPeers()
      if (surface.snapshot().activeTurnId) this.parking.cancel(entry)
      else this.parking.schedule(record.paneId)
    })
    this.peers.set(record.paneId, entry)
    return entry
  }

  private async withAwake<T>(paneId: ChatPaneId, action: (surface: ChatSurface) => Promise<T>): Promise<T> {
    const entry = await this.parking.wake(paneId)
    this.parking.cancel(entry)
    try {
      return await action(entry.surface)
    } finally {
      this.parking.schedule(paneId)
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
    return [...this.peers].map(([paneId, entry]) => {
      const record = this.record(paneId)
      return summaryOf(paneId, entry.surface.snapshot(), entry.updatedAt, record.modelId, record.continuation ?? null)
    })
  }

  private emitWorkspace(): void {
    this.emit('event', { type: 'workspace', snapshot: this.snapshot() } satisfies ChatWorkspaceEvent)
  }

  private emitPeers(): void {
    this.emit('event', {
      type: 'peers',
      selectedPaneId: this.selectedPaneId,
      peers: this.peerSummaries()
    } satisfies ChatWorkspaceEvent)
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
    continuation
  }
}

function summaryOf(
  paneId: string,
  snapshot: ChatSnapshot,
  updatedAt: number,
  persistedModelId: string | null,
  continuation: ChatContinuation | null
): ChatPeerSummary {
  const firstUser = snapshot.items.find((item) => item.type === 'user')
  const latest = snapshot.items.at(-1)
  const title = snapshot.threadName || (firstUser?.type === 'user' ? firstUser.text.trim().split('\n')[0] : '') ||
    (continuation ? `Continuing: ${continuation.sourceTitle}` : 'New chat')
  return {
    paneId,
    parentPaneId: null,
    kind: 'peer',
    provider: snapshot.provider,
    modelId: snapshot.selectedModel ?? persistedModelId,
    threadId: snapshot.threadId,
    title: title.length > 60 ? `${title.slice(0, 59)}…` : title,
    preview: itemText(latest),
    running: snapshot.activeTurnId !== null,
    activity: latest?.type === 'tool' ? latest.label : null,
    updatedAt
  }
}

function subagentSummaries(parent: ChatPeerSummary, snapshot: ChatSnapshot): ChatPeerSummary[] {
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

function pageResult(summary: ChatPeerSummary, items: ChatSnapshot['items'], cursor: number, limit: number): PeerChatReadResult {
  const start = Math.max(0, Math.floor(cursor))
  const count = Math.min(100, Math.max(1, Math.floor(limit)))
  const page = items.slice(start, start + count)
  return { ...summary, items: page, nextCursor: start + page.length < items.length ? start + page.length : null }
}

function itemText(item: ChatSnapshot['items'][number] | undefined): string {
  if (!item) return ''
  if (item.type === 'user' || item.type === 'assistant' || item.type === 'notice' || item.type === 'plan' || item.type === 'reasoning') return item.text
  if (item.type === 'tool') return item.detail || item.label
  if (item.type === 'command') return item.command
  return item.type === 'screenshot' ? item.caption : item.type === 'fileChange' ? `${item.changes.length} file changes` : ''
}
