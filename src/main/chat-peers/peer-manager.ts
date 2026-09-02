import { EventEmitter } from 'node:events'
import type { ChatAttachment, ChatEvent, ChatSnapshot, ChatThreadSummary } from '../../shared/chat.js'
import type {
  ChatPaneId,
  ChatPeerSummary,
  ChatWorkspaceEvent,
  ChatWorkspaceSnapshot,
  PeerChatReadResult
} from '../../shared/chat-peers.js'
import type { ChatPeerRecord } from '../../shared/types.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
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
  continueInNewPeer(paneId: ChatPaneId): Promise<ChatPaneId>
  openThread(paneId: ChatPaneId, threadId: string): Promise<void>
  archiveThread(threadId: string): Promise<void>
  beginLogin(): Promise<string | null>
  on(event: 'event', listener: (event: ChatWorkspaceEvent) => void): unknown
}

type PeerEntry = {
  surface: ChatSurface
  updatedAt: number
}

export class ChatPeerManager extends EventEmitter implements ChatWorkspaceSurface {
  private readonly peers = new Map<ChatPaneId, PeerEntry>()
  private selectedPaneId: ChatPaneId

  constructor(
    private readonly settings: AppSettingsAccess,
    private readonly createSurface: ChatPeerFactory
  ) {
    super()
    const saved = settings.get()
    const records = saved.chatPeers.length > 0
      ? saved.chatPeers
      : [freshRecord(saved.chatModelId, saved.chatReasoningEffort)]
    this.selectedPaneId = saved.chatSelectedPaneId ?? records[0]!.paneId
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

  async start(): Promise<void> {
    await Promise.all([...this.peers.values()].map((entry) => entry.surface.start()))
  }

  stop(): void {
    for (const entry of this.peers.values()) entry.surface.stop()
  }

  send(paneId: ChatPaneId, text: string, attachments: ChatAttachment[]): Promise<void> {
    return this.requirePeer(paneId).surface.send(text, attachments)
  }

  interrupt(paneId: ChatPaneId): Promise<void> {
    return this.requirePeer(paneId).surface.interrupt()
  }

  async selectPane(paneId: ChatPaneId): Promise<void> {
    this.requirePeer(paneId)
    if (paneId === this.selectedPaneId) return
    this.selectedPaneId = paneId
    await this.settings.set({ chatSelectedPaneId: paneId })
    this.emitWorkspace()
  }

  selectModel(paneId: ChatPaneId, modelId: string): Promise<void> {
    return this.requirePeer(paneId).surface.selectModel(modelId)
  }

  selectReasoningEffort(paneId: ChatPaneId, effort: string): Promise<void> {
    return this.requirePeer(paneId).surface.selectReasoningEffort(effort)
  }

  async listThreads(): Promise<ChatThreadSummary[]> {
    const lists = await Promise.allSettled([...this.peers.values()].map((entry) => entry.surface.listThreads()))
    const byId = new Map<string, ChatThreadSummary>()
    for (const result of lists) {
      if (result.status !== 'fulfilled') continue
      for (const thread of result.value) byId.set(thread.id, thread)
    }
    if (lists.length > 0 && lists.every((result) => result.status === 'rejected')) {
      throw (lists[0] as PromiseRejectedResult).reason
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async newPeer(): Promise<ChatPaneId> {
    const current = this.requirePeer(this.selectedPaneId).surface.snapshot()
    const record = freshRecord(current.selectedModel, current.selectedReasoningEffort)
    const settings = this.settings.get()
    await this.settings.set({
      chatPeers: [...settings.chatPeers, record],
      chatSelectedPaneId: record.paneId
    })
    const entry = this.attach(record)
    this.selectedPaneId = record.paneId
    this.emitWorkspace()
    void entry.surface.start()
    return record.paneId
  }

  async closePeer(paneId: ChatPaneId): Promise<void> {
    const entry = this.peers.get(paneId)
    if (!entry) return
    entry.surface.stop()
    this.peers.delete(paneId)
    const settings = this.settings.get()
    const remaining = settings.chatPeers.filter((record) => record.paneId !== paneId)
    if (remaining.length === 0) {
      const fresh = freshRecord(null, null)
      remaining.push(fresh)
      this.attach(fresh)
      this.selectedPaneId = fresh.paneId
      void this.requirePeer(fresh.paneId).surface.start()
    } else if (this.selectedPaneId === paneId) {
      this.selectedPaneId = remaining[0]!.paneId
    }
    await this.settings.set({
      chatPeers: remaining,
      chatSelectedPaneId: this.selectedPaneId
    })
    this.emitWorkspace()
  }

  async continueInNewPeer(paneId: ChatPaneId): Promise<ChatPaneId> {
    const source = this.requirePeer(paneId).surface
    const snapshot = source.snapshot()
    if (snapshot.activeTurnId) throw new Error('Stop the current turn before continuing in a new chat')
    if (!snapshot.items.some((item) => item.type === 'user')) throw new Error('There is no conversation to continue yet')
    const sourceRecord = this.record(paneId)
    const historyRecord = { ...sourceRecord, paneId: crypto.randomUUID() }
    const settings = this.settings.get()
    await this.settings.set({ chatPeers: [...settings.chatPeers, historyRecord] })
    const history = this.attach(historyRecord)
    await source.continueInNewThread()
    this.emitWorkspace()
    void history.surface.start()
    return paneId
  }

  openThread(paneId: ChatPaneId, threadId: string): Promise<void> {
    return this.requirePeer(paneId).surface.openThread(threadId)
  }

  async archiveThread(threadId: string): Promise<void> {
    const matching = [...this.peers.values()].find((entry) => entry.surface.snapshot().threadId === threadId)
    await (matching ?? this.requirePeer(this.selectedPaneId)).surface.archiveThread(threadId)
  }

  beginLogin(): Promise<string | null> {
    return this.requirePeer(this.selectedPaneId).surface.beginLogin()
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
    const entry = { surface, updatedAt: Date.now() }
    surface.on('event', (event: ChatEvent) => {
      entry.updatedAt = Date.now()
      this.emit('event', { type: 'pane', paneId: record.paneId, event } satisfies ChatWorkspaceEvent)
      this.emitPeers()
    })
    this.peers.set(record.paneId, entry)
    return entry
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
    return [...this.peers].map(([paneId, entry]) => summaryOf(paneId, entry.surface.snapshot(), entry.updatedAt))
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

function freshRecord(modelId: string | null, reasoningEffort: string | null): ChatPeerRecord {
  return {
    paneId: crypto.randomUUID(),
    provider: modelId?.startsWith('claude:') ? 'claude' : 'codex',
    threadId: null,
    codexThreadId: null,
    claudeSessionId: null,
    modelId,
    reasoningEffort
  }
}

function summaryOf(paneId: string, snapshot: ChatSnapshot, updatedAt: number): ChatPeerSummary {
  const firstUser = snapshot.items.find((item) => item.type === 'user')
  const latest = snapshot.items.at(-1)
  const title = snapshot.threadName || (firstUser?.type === 'user' ? firstUser.text.trim().split('\n')[0] : '') || 'New chat'
  return {
    paneId,
    parentPaneId: null,
    kind: 'peer',
    provider: snapshot.provider,
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
