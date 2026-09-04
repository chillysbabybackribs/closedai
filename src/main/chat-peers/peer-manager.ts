import { EventEmitter } from 'node:events'
import type { ChatAttachment, ChatEvent, ChatSnapshot, ChatThreadSummary } from '../../shared/chat.js'
import { CHAT_HISTORY_PAGE_SIZE, type ChatHistoryPage, type ChatHistoryWindow } from '../../shared/chat.js'
import type {
  ChatContinuationSource,
  ChatPaneId,
  ChatPeerSummary,
  ChatRowSummary,
  ChatWorkspaceEvent,
  ChatWorkspaceSnapshot,
  PeerChatReadResult
} from '../../shared/chat-peers.js'
import { chatProviderOfId } from '../../shared/chat-providers.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import type { ChatContinuation } from '../../shared/types.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { buildThreadHandoff } from '../chat-context/thread-handoff.js'
import { ChatMemory } from '../chat-context/chat-memory.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { traceLog } from '../trace/trace-log.js'
import { PeerChatCatalog } from './peer-chat-catalog.js'
import { PeerEmitThrottle, rendererSnapshot, rowSummary } from './peer-events.js'
import { PeerIdleParking } from './peer-idle-parking.js'
import { PeerLifecycle, type ChatPeerFactory, type PeerEntry } from './peer-lifecycle.js'
import { selectedMirror } from './peer-settings.js'
import { pageResult, subagentSummaries } from './peer-summary.js'
import { schedulePaneWarm } from './provider-warm.js'

export type { ChatPeerFactory } from './peer-lifecycle.js'

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
  /** The workspace's chats now, from the store; provider catalogs are reconciled in the background. */
  listChats(): Promise<ChatRowSummary[]>
  /** Every thread the providers and the store know, reconciled first; for tools that search by title. */
  listThreads(): Promise<ChatThreadSummary[]>
  newPeer(): Promise<ChatPaneId>
  closePeer(paneId: ChatPaneId): Promise<void>
  continueInNewPeer(source: ChatContinuationSource, modelId: string | null): Promise<ChatPaneId>
  /** Show a chat: select it if attached, else attach it, replacing the selected chat only when that one is blank. */
  openChat(chatId: string): Promise<ChatPaneId>
  openThread(paneId: ChatPaneId, threadId: string): Promise<void>
  /** Hide a chat: archive its provider thread if it has one, keep the record as archived, detach its pane. */
  archiveChat(chatId: string): Promise<void>
  archiveThread(threadId: string): Promise<void>
  compactConversation(paneId: ChatPaneId): Promise<void>
  selectProject(projectPath: string | null): Promise<void>
  beginLogin(): Promise<string | null>
  on(event: 'event', listener: (event: ChatWorkspaceEvent) => void): unknown
}

export class ChatPeerManager extends EventEmitter implements ChatWorkspaceSurface {
  readonly memory: ChatMemory
  private selectedPaneId: ChatPaneId
  private readonly lifecycle: PeerLifecycle
  private readonly parking: PeerIdleParking
  private readonly catalog: PeerChatCatalog
  /** Tail of each pane's operation chain, so callers on one pane cannot interleave. */
  private readonly paneOperations = new Map<ChatPaneId, Promise<void>>()
  private readonly chatsEmit = new PeerEmitThrottle(() => this.emitChats())

  constructor(
    private readonly settings: AppSettingsAccess,
    private readonly store: ChatStore,
    createSurface: ChatPeerFactory,
    idleParkMs?: number,
    private readonly workspaceSelector?: ChatWorkspaceSelector
  ) {
    super()
    this.memory = new ChatMemory(store, (paneId) => this.lifecycle.get(paneId)?.surface ?? null)
    this.parking = new PeerIdleParking((paneId) => this.lifecycle.get(paneId), () => this.selectedPaneId, idleParkMs)
    this.lifecycle = new PeerLifecycle(store, settings, createSurface, this.parking, (entry, event) => this.onPaneEvent(entry, event))
    this.catalog = new PeerChatCatalog(store, () => this.workspace(), (fn) => this.withAwake(this.selectedPaneId, fn))
    const saved = settings.get()
    this.selectedPaneId = this.restoreOpenChats(saved.chatOpenIds, saved.chatSelectedPaneId, null, null)
    if (saved.chatSelectedPaneId !== this.selectedPaneId || saved.chatOpenIds.join() !== this.lifecycle.ids().join()) {
      void this.persistOpenChats().catch((error: unknown) => {
        console.warn('[chat-peers] could not persist open chats:', error instanceof Error ? error.message : String(error))
      })
    }
    store.on('change', () => this.chatsEmit.schedule())
  }

  snapshot(window?: ChatHistoryWindow): ChatWorkspaceSnapshot {
    const entry = this.lifecycle.require(this.selectedPaneId)
    const selected = entry.surface.snapshot(window)
    return {
      selectedPaneId: this.selectedPaneId,
      chats: this.chatRows(),
      selected: window ? rendererSnapshot(selected, entry.display.current.title) : selected,
      workspace: this.workspaceSelector?.current()
    }
  }

  readHistoryPage(paneId: ChatPaneId, threadId: string | null, beforeItemId: string): ChatHistoryPage {
    if (typeof beforeItemId !== 'string' || !beforeItemId) throw new Error('Choose a history cursor')
    const snapshot = this.lifecycle.require(paneId).surface.snapshot({ beforeItemId, limit: CHAT_HISTORY_PAGE_SIZE })
    if (snapshot.threadId !== threadId) throw new Error('The chat changed while loading history')
    return { items: snapshot.items, hasEarlier: snapshot.history?.hasEarlier ?? false }
  }

  /** One pane's live snapshot without waking a parked peer; null for an unknown pane. */
  paneSnapshot(paneId: ChatPaneId): ChatSnapshot | null {
    return this.lifecycle.get(paneId)?.surface.snapshot() ?? null
  }

  async start(): Promise<void> {
    // Persisted panes are history, not live work. Warming every one creates an app-server per
    // pane after each relaunch; the selected pane is the only surface startup needs immediately.
    await this.wake(this.selectedPaneId)
    await this.trimAttached()
  }

  stop(): void {
    // A turn that ended just before quit has a `chats` update waiting; deliver it so the row moves.
    this.chatsEmit.flush()
    this.lifecycle.detachAll()
  }

  async send(paneId: ChatPaneId, text: string, attachments: ChatAttachment[]): Promise<void> {
    const entry = this.lifecycle.require(paneId)
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
    this.lifecycle.require(paneId)
    if (paneId === this.selectedPaneId) return
    const previousPaneId = this.selectedPaneId
    this.selectedPaneId = paneId
    // A blank chat the user clicked away from never became one; keep it and the drawer fills
    // with "New chat" rows. One mid-open (busy) is not blank, it is about to hold a thread.
    if (this.lifecycle.peers.size > 1) this.lifecycle.discardIfBlank(previousPaneId)
    this.parking.schedule(previousPaneId)
    // Paint the destination from the snapshot it already holds before its runtime is back.
    // Waking replays the thread from the provider's store and starts a CLI process; awaiting
    // that here kept the pane on the previous chat for the whole start-up. The wake emits its
    // own `replace` when it lands.
    this.emitWorkspace()
    await this.persistOpenChats()
    this.scheduleWarm(paneId)
    this.wakeLater(paneId, 'wake pane')
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

  async listChats(): Promise<ChatRowSummary[]> {
    void this.catalog.reconcile().catch((error: unknown) => {
      console.warn('[chat-peers] thread catalog scan failed:', error instanceof Error ? error.message : String(error))
    })
    return this.chatRows()
  }

  async listThreads(): Promise<ChatThreadSummary[]> {
    await this.catalog.reconcile()
    return this.store.list(this.workspace().cwd).filter((record) => record.threadId).map((record) => ({
      id: record.threadId!,
      title: record.title ?? 'New chat',
      preview: record.preview,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }))
  }

  async newPeer(): Promise<ChatPaneId> {
    const current = this.lifecycle.require(this.selectedPaneId).surface.snapshot({ limit: 0 })
    return this.newChat(current.selectedModel, current.selectedReasoningEffort, null)
  }

  /**
   * Create a chat, attach it, and select it. The workspace event goes out before any write so
   * the pane paints at once; settings and the LRU trim follow, and the wake last.
   */
  private async newChat(modelId: string | null, reasoningEffort: string | null, continuation: ChatContinuation | null): Promise<ChatPaneId> {
    const previousPaneId = this.selectedPaneId
    const { cwd, projectPath } = this.workspace()
    const record = this.store.create({ cwd, projectPath, provider: chatProviderOfId(modelId), modelId, reasoningEffort, continuation })
    this.lifecycle.attach(record)
    this.selectedPaneId = record.id
    this.parking.schedule(previousPaneId)
    this.emitWorkspace()
    await this.persistOpenChats()
    await this.trimAttached()
    this.wakeLater(record.id, 'start the new chat')
    return record.id
  }

  async closePeer(paneId: ChatPaneId): Promise<void> {
    if (!this.lifecycle.get(paneId)) return
    const closing = this.lifecycle.require(paneId).surface.snapshot({ limit: 0 })
    if (!this.lifecycle.discardIfBlank(paneId)) this.lifecycle.detach(paneId)
    if (this.lifecycle.peers.size === 0) {
      // Closing the last chat opens an empty one; it keeps the model the workspace was on
      // rather than dropping back to the first provider's default.
      const { cwd, projectPath } = this.workspace()
      const fresh = this.store.create({
        cwd, projectPath, provider: chatProviderOfId(closing.selectedModel), modelId: closing.selectedModel, reasoningEffort: closing.selectedReasoningEffort
      })
      this.lifecycle.attach(fresh)
      this.selectedPaneId = fresh.id
    } else if (this.selectedPaneId === paneId) {
      this.selectedPaneId = this.lifecycle.ids()[0]!
    }
    await this.persistOpenChats()
    await this.wake(this.selectedPaneId)
    this.emitWorkspace()
  }

  async continueInNewPeer(source: ChatContinuationSource, modelId: string | null): Promise<ChatPaneId> {
    if (!source?.paneId && !source?.threadId) throw new Error('Choose a chat to continue')
    const current = this.lifecycle.require(this.selectedPaneId).surface.snapshot()
    let sourceSnapshot: ChatSnapshot | null = null
    let sourceThreadId = source.threadId
    let sourceProvider = sourceThreadId ? chatProviderOfId(sourceThreadId) : current.provider
    let items: ChatSnapshot['items']
    let threadName: string | null

    if (source.paneId && this.lifecycle.get(source.paneId)) {
      sourceSnapshot = await this.withAwake(source.paneId, async (surface) => surface.snapshot())
      if (sourceSnapshot.activeTurnId) throw new Error('Stop the current turn before continuing in a new chat')
      sourceThreadId = sourceSnapshot.threadId ?? sourceThreadId
      sourceProvider = sourceSnapshot.provider
      items = sourceSnapshot.items
      threadName = sourceSnapshot.threadName
    } else {
      // A detached chat is read from its thread without attaching it.
      const threadId = sourceThreadId ?? (source.paneId ? this.store.get(source.paneId)?.threadId ?? null : null)
      if (!threadId) throw new Error('There is no conversation to continue yet')
      const content = await this.withAwake(this.selectedPaneId, (surface) => surface.readThread(threadId))
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
    const savedCheckpoint = source.paneId ? this.store.get(source.paneId)?.checkpoint ?? null : null
    const checkpoint = savedCheckpoint?.threadId === sourceThreadId
      && items.some((item) => item.id === savedCheckpoint.throughItemId) ? savedCheckpoint : null
    const handoff = buildThreadHandoff(items, threadName, checkpoint)
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
      sourceThroughItemId: items.at(-1)?.id ?? null,
      checkpoint,
      handoff: handoff.text,
      createdAt: Date.now()
    }
    return this.newChat(targetModel, targetEffort, continuation)
  }

  async openChat(chatId: string): Promise<ChatPaneId> {
    const record = this.store.get(chatId)
    if (!record || record.archived) throw new Error('That chat is no longer available')
    if (record.cwd !== this.workspace().cwd) throw new Error('That chat belongs to another project')
    if (this.lifecycle.get(chatId)) {
      await this.selectPane(chatId)
      return chatId
    }
    // A blank selected chat is replaced, so reading history from a fresh "New chat" does not leave
    // that empty pane behind; anything else keeps its conversation and the chat opens beside it.
    const previousPaneId = this.selectedPaneId
    this.lifecycle.attach(record)
    this.selectedPaneId = chatId
    if (this.lifecycle.peers.size > 1) this.lifecycle.discardIfBlank(previousPaneId)
    this.parking.schedule(previousPaneId)
    this.emitWorkspace()
    await this.persistOpenChats()
    await this.trimAttached()
    this.catalog.invalidate()
    this.scheduleWarm(chatId)
    this.wakeLater(chatId, 'open chat')
    return chatId
  }

  /** Open a provider thread by id: the chat that holds it, adopted first if the store has none. */
  async openThread(_paneId: ChatPaneId, threadId: string): Promise<void> {
    const { cwd, projectPath } = this.workspace()
    const record = this.store.findByThreadId(threadId) ?? this.store.adopt(cwd, projectPath, {
      id: threadId, title: 'New chat', preview: '', createdAt: Date.now(), updatedAt: Date.now()
    }, null)
    await this.openChat(record.id)
  }

  async archiveChat(chatId: string): Promise<void> {
    const record = this.store.get(chatId)
    if (!record) return
    const attached = this.lifecycle.get(chatId) !== undefined
    if (record.threadId) {
      const threadId = record.threadId
      await this.withAwake(attached ? chatId : this.selectedPaneId, (surface) => surface.archiveThread(threadId))
    }
    this.store.archive(chatId)
    if (attached) await this.closePeer(chatId)
    // The drawer refreshes right after this; it must not be handed the list with the row still in it.
    this.catalog.invalidate()
    this.emitChats()
  }

  async archiveThread(threadId: string): Promise<void> {
    const record = this.store.findByThreadId(threadId)
    if (record) return this.archiveChat(record.id)
    await this.withAwake(this.selectedPaneId, (surface) => surface.archiveThread(threadId))
    this.catalog.invalidate()
    this.emitChats()
  }

  compactConversation(paneId: ChatPaneId): Promise<void> {
    return this.withAwake(paneId, (surface) => surface.compactConversation())
  }

  /** A provider process cannot safely change directories mid-turn. Swap the active pane set
   * only after its project-scoped state has been persisted and the destination restored. */
  async selectProject(projectPath: string | null): Promise<void> {
    if (!this.workspaceSelector) throw new Error('Project selection is unavailable')
    if (this.lifecycle.ids().some((chatId) => this.lifecycle.isRunning(chatId))) {
      throw new Error('Stop running chats before changing projects')
    }
    const current = this.lifecycle.require(this.selectedPaneId).surface.snapshot({ limit: 0 })
    const selection = this.workspaceSelector.current()
    if (selection.projectPath === projectPath) return

    this.lifecycle.detachAll()
    this.catalog.invalidate()
    await this.workspaceSelector.select(projectPath, {
      modelId: current.selectedModel,
      reasoningEffort: current.selectedReasoningEffort
    })

    const restored = this.settings.get()
    this.selectedPaneId = this.restoreOpenChats(restored.chatOpenIds, restored.chatSelectedPaneId, current.selectedModel, current.selectedReasoningEffort)
    await this.persistOpenChats()
    this.emitWorkspace()
    this.wakeLater(this.selectedPaneId, 'start the project chat')
  }

  beginLogin(): Promise<string | null> {
    return this.withAwake(this.selectedPaneId, (surface) => surface.beginLogin())
  }

  listReadable(callerPaneId: string | null): ChatPeerSummary[] {
    return this.peerSummaries().flatMap((peer) => [
      ...(peer.paneId === callerPaneId ? [] : [peer]),
      ...subagentSummaries(peer, this.lifecycle.require(peer.paneId).surface.snapshot())
    ])
  }

  readReadable(chatId: string, callerPaneId: string | null, cursor = 0, limit = 50): PeerChatReadResult | null {
    const direct = this.peerSummaries().find((peer) => peer.paneId === chatId && peer.paneId !== callerPaneId)
    if (direct) return pageResult(direct, this.lifecycle.require(chatId).surface.snapshot().items, cursor, limit)
    for (const peer of this.peerSummaries()) {
      const snapshot = this.lifecycle.require(peer.paneId).surface.snapshot()
      const subagent = subagentSummaries(peer, snapshot).find((entry) => entry.paneId === chatId)
      if (subagent) {
        const itemId = chatId.slice(peer.paneId.length + 1)
        return pageResult(subagent, snapshot.items.filter((item) => item.id === itemId), cursor, limit)
      }
    }
    return null
  }

  /**
   * Attach the workspace's saved open chats, or a fresh one when it has none, and pick the
   * selection. Ids whose records are gone (archived, removed) are skipped rather than failing.
   */
  private restoreOpenChats(openIds: string[], selectedId: string | null, modelId: string | null, effort: string | null): ChatPaneId {
    const { cwd, projectPath } = this.workspace()
    const records = openIds.map((id) => this.store.get(id)).filter((record): record is ChatRecord =>
      record !== undefined && !record.archived && record.cwd === cwd)
    if (records.length === 0) {
      const saved = this.settings.get()
      const model = modelId ?? saved.chatModelId
      records.push(this.store.create({
        cwd, projectPath, provider: chatProviderOfId(model), modelId: model, reasoningEffort: effort ?? saved.chatReasoningEffort
      }))
    }
    for (const record of records) this.lifecycle.attach(record)
    return selectedId && records.some((record) => record.id === selectedId) ? selectedId : records[0]!.id
  }

  private workspace(): ChatWorkspaceSelection {
    if (this.workspaceSelector) return this.workspaceSelector.current()
    const saved = this.settings.get()
    return { cwd: saved.chatWorkspacePath ?? '', projectPath: saved.chatProjectPath }
  }

  /** Detach beyond the cap and record the open set; the drawer learns of the change at once. */
  private async trimAttached(): Promise<void> {
    const detached = this.lifecycle.trim([this.selectedPaneId])
    if (detached.length === 0) return
    this.chatsEmit.schedule()
    await this.persistOpenChats()
  }

  /** Which chats are open and which is selected, plus the flat mirror of the selected one. */
  private async persistOpenChats(): Promise<void> {
    const selected = this.store.get(this.selectedPaneId) ?? null
    await this.settings.set({
      chatOpenIds: this.lifecycle.ids(),
      chatSelectedPaneId: this.selectedPaneId,
      ...selectedMirror(selected)
    })
  }

  private wake(paneId: ChatPaneId): Promise<PeerEntry> {
    return this.lifecycle.withBusy(paneId, () => this.parking.wake(paneId) as Promise<PeerEntry>)
  }

  /** Warm the provider after the user dwells on a pane, without blocking selection paint. */
  private scheduleWarm(paneId: ChatPaneId): void {
    schedulePaneWarm(paneId, async (target) => {
      if (target !== this.selectedPaneId) return
      await this.withAwake(target, (surface) => surface.start())
    })
  }

  /**
   * Start a chat's runtime without holding the caller. A blank chat the user left while it was
   * still starting could not be discarded then (the start might have been bringing a thread);
   * once it has landed empty and unselected, it goes.
   */
  private wakeLater(paneId: ChatPaneId, what: string): void {
    void this.wake(paneId).then(async () => {
      if (paneId !== this.selectedPaneId && this.lifecycle.peers.size > 1 && this.lifecycle.discardIfBlank(paneId)) {
        await this.persistOpenChats()
      }
    }).catch((error: unknown) => {
      console.warn(`[chat-peers] could not ${what}:`, error instanceof Error ? error.message : String(error))
    })
  }

  private onPaneEvent(entry: PeerEntry, event: ChatEvent): void {
    const paneId = entry.chatId
    traceLog.responses.event(paneId, event)
    entry.updatedAt = Date.now()
    const oldTitle = entry.display.current.title
    const oldPreview = entry.display.current.preview
    const wasRunning = entry.display.current.running
    entry.display.update(event, entry.updatedAt)
    const rendererEvent = event.type === 'replace'
      ? { ...event, snapshot: rendererSnapshot(event.snapshot, entry.display.current.title) }
      : event
    this.emit('event', { type: 'pane', paneId, event: rendererEvent } satisfies ChatWorkspaceEvent)
    this.chatsEmit.schedule()
    const running = entry.display.current.running
    const turnBoundary = wasRunning !== running
    if (turnBoundary || entry.display.current.title !== oldTitle || (event.type === 'item' && entry.display.current.preview !== oldPreview)) {
      this.lifecycle.rememberDisplay(paneId, entry.display.current, entry.updatedAt, turnBoundary ? wasRunning && !running : null)
    }
    if (turnBoundary && !running) this.catalog.invalidate()
    if (running) this.parking.cancel(entry)
    else this.parking.schedule(paneId)
  }

  /**
   * One pane runs one operation at a time. Waking is asynchronous, so two callers could
   * otherwise interleave: a model switch landing between another caller's wake and its send
   * moves the pane to a different provider, and the send starts its turn on the surface the
   * pane just left — invisibly, because the pane now reports on a surface with no turn.
   */
  private async withAwake<T>(paneId: ChatPaneId, action: (surface: ChatSurface) => Promise<T>): Promise<T> {
    const queued = (this.paneOperations.get(paneId) ?? Promise.resolve()).then(async () => {
      const entry = await this.wake(paneId)
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

  private peerSummaries(): ChatPeerSummary[] {
    return [...this.lifecycle.peers.values()].map((entry) => ({ ...entry.display.current }))
  }

  /** Every chat of the workspace: attached ones as their live summary, the rest from the store. */
  private chatRows(): ChatRowSummary[] {
    return this.store.list(this.workspace().cwd).map((record) =>
      rowSummary(record, this.lifecycle.get(record.id)?.display.current ?? null))
  }

  private emitWorkspace(): void {
    this.emit('event', { type: 'workspace', snapshot: this.snapshot({ limit: CHAT_HISTORY_PAGE_SIZE }) } satisfies ChatWorkspaceEvent)
  }

  private emitChats(): void {
    this.emit('event', { type: 'chats', selectedPaneId: this.selectedPaneId, chats: this.chatRows() } satisfies ChatWorkspaceEvent)
  }
}
