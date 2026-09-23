import { EventEmitter } from 'node:events'
import type { ChatAttachment, ChatEvent, ChatSnapshot, ChatThreadSummary } from '../../shared/chat.js'
import { CHAT_TURN_PAGE_SIZE, type ChatHistoryPage, type ChatHistoryWindow } from '../../shared/chat.js'
import type {
  ChatContinuationSource,
  ChatPaneId,
  ChatPeerSummary,
  ChatRowSummary,
  ChatWorkspaceEvent,
  ChatWorkspaceSnapshot,
  PeerChatReadOptions,
  PeerChatReadResult
} from '../../shared/chat-peers.js'
import { chatProviderOfId } from '../../shared/chat-providers.js'
import type { EnableCoordinatorResult, OpenCoordinatorWorkspaceResult } from '../../shared/coordinator.js'
import type { ChatRecordSeed } from '../../shared/chat-store.js'
import type { ChatContinuation } from '../../shared/types.js'
import { groupMembers, pickCoordinatorWorker } from './coordinator.js'
import { enableCoordinator, openCoordinatorWorkspace, type PeerCoordinatorHost } from './peer-coordinator-ops.js'
import { stopCoordinatorCrew as haltCoordinatorCrew, stopCoordinatorCrewForManager, wireCoordinatorAfterSend } from './peer-coordinator-bridge.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import { refreshModelPicker as refreshPaneModelPickers, selectedHub as hubForSelectedPane } from './peer-model-settings.js'
import { continuePeer } from './peer-continuation.js'
import { DeferredProjectSwitch } from './deferred-project-switch.js'
import { ChatMemory } from '../chat-context/chat-memory.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { ChatTranscriptCache } from '../chat-store/chat-transcript-cache.js'
import { traceLog } from '../trace/trace-log.js'
import { PeerChatCatalog } from './peer-chat-catalog.js'
import { PeerEmitThrottle, syncStoreCheckpoint } from './peer-events.js'
import {
  peerManagerChatRows,
  peerManagerEmitChats,
  peerManagerEmitWorkspace,
  peerManagerListReadable,
  peerManagerOnPaneEvent,
  peerManagerPersistOpenChats,
  peerManagerReadReadable,
  peerManagerRememberTranscript,
  peerManagerRendererView,
  peerManagerScheduleWarm,
  peerManagerTrimAttached,
  peerManagerWake,
  peerManagerWakeLater,
  peerManagerWithAwake,
  peerManagerWorkspace,
  type PeerManagerSupportHost
} from './peer-manager-support.js'
import { PeerIdleParking } from './peer-idle-parking.js'
import { PeerLifecycle, type ChatPeerFactory, type PeerEntry } from './peer-lifecycle.js'
import { PeerProjectChanges, projectConversationPatch, rememberChatProjects } from './peer-project.js'
import { PeerArchives } from './peer-archive.js'
import type { ChatWorkspaceSelection, ChatWorkspaceSelector, ChatWorkspaceSurface } from './peer-workspace.js'
import type { BrowserAssignmentIdleRelease } from '../tools/browser/assignment-idle-release.js'

export type { ChatPeerFactory } from './peer-lifecycle.js'

export type { ChatWorkspaceSelection, ChatWorkspaceSelector, ChatWorkspaceSurface } from './peer-workspace.js'

export class ChatPeerManager extends EventEmitter implements ChatWorkspaceSurface {
  readonly memory: ChatMemory
  readonly projectSwitch: DeferredProjectSwitch
  private selectedPaneId: ChatPaneId
  private visiblePaneIds = new Set<ChatPaneId>()
  private retainedTabIds = new Set<ChatPaneId>()
  private visibilityRevision = 0
  private selectingProject = false
  private readonly lifecycle: PeerLifecycle
  private readonly parking: PeerIdleParking
  private readonly catalog: PeerChatCatalog
  private readonly projectChanges: PeerProjectChanges
  /** Tail of each pane's operation chain, so callers on one pane cannot interleave. */
  private readonly paneOperations = new Map<ChatPaneId, Promise<void>>()
  private readonly crewInternalSend = new Set<ChatPaneId>()
  private readonly chatsEmit = new PeerEmitThrottle(() => this.emitChats())
  private readonly archives: PeerArchives

  constructor(
    private readonly settings: AppSettingsAccess,
    private readonly store: ChatStore,
    createSurface: ChatPeerFactory,
    idleParkMs?: number,
    private readonly workspaceSelector?: ChatWorkspaceSelector,
    private readonly transcripts: ChatTranscriptCache = ChatTranscriptCache.inMemory(),
    private readonly cancelPaneWork: (paneId: ChatPaneId) => void = () => {},
    private readonly browserAssignmentIdle: BrowserAssignmentIdleRelease | null = null
  ) {
    super()
    this.memory = new ChatMemory(store, (paneId) => this.lifecycle.get(paneId)?.surface ?? null)
    this.parking = new PeerIdleParking((paneId) => this.lifecycle.get(paneId), () => this.selectedPaneId, idleParkMs)
    this.lifecycle = new PeerLifecycle(store, settings, createSurface, this.parking, (entry, event) => this.onPaneEvent(entry, event), cancelPaneWork,
      (paneId) => this.browserAssignmentIdle?.detach(paneId))
    this.projectChanges = new PeerProjectChanges({
      record: (id) => { this.lifecycle.require(id); return store.require(id) },
      idle: (id) => Boolean(this.lifecycle.get(id)) && !this.lifecycle.isRunning(id)
        && !this.lifecycle.require(id).surface.snapshot({ limit: 0 }).pausedTurnId,
      apply: (id, selection) => this.withAwake(id, async (surface) => {
        if (this.lifecycle.isRunning(id) || surface.snapshot({ limit: 0 }).pausedTurnId) {
          throw new Error('The chat started working before its directory could change; choose the folder again')
        }
        const source = surface.snapshot()
        const record = store.require(id)
        await rememberChatProjects(settings, record, selection)
        if (this.projectChanges.selection(id) !== selection || this.lifecycle.get(id)?.surface !== surface) return
        this.lifecycle.relocate(id, projectConversationPatch(record, source, selection), source)
        this.catalog.invalidate()
        await this.persistOpenChats()
        this.emitWorkspace()
        this.wakeLater(id, 'start chat in its new directory')
      }),
      changed: () => this.emitChats(),
      failed: (id, error) => this.emit('event', { type: 'pane', paneId: id, event: { type: 'item',
        item: { type: 'notice', id: `project-change-${Date.now()}`, turnId: null, tone: 'error',
          text: `Could not change this chat’s directory: ${String(error)}` } } } satisfies ChatWorkspaceEvent)
    })
    this.projectSwitch = new DeferredProjectSwitch({
      cwd: () => this.workspace().cwd,
      source: (id, full) => this.lifecycle.get(id)?.surface.snapshot(full ? undefined : { limit: 0 }) ?? null,
      record: (id) => this.store.get(id) ?? null,
      idle: () => this.paneOperations.size === 0 && [...this.lifecycle.peers.values()]
        .every((entry) => entry.busy === 0 && !this.lifecycle.isRunning(entry.chatId) && !entry.surface.snapshot({ limit: 0 }).pausedTurnId),
      switchProject: (path) => this.selectProject(path, true),
      create: (model, effort, continuation) => this.newChat(model, effort, continuation, this.workspace()),
      send: (id, text) => this.withAwake(id, async (surface) => {
        if (surface.snapshot({ limit: 0 }).cwd !== this.workspace().cwd) throw new Error('Provider working directory verification failed')
        await surface.send(text, [])
        this.store.update(id, { messageSentAt: Date.now() })
      }, true),
      changed: (status) => {
        this.emit('event', { type: 'pane', paneId: status.destinationPaneId ?? status.paneId,
          event: { type: 'item', item: { type: 'notice', id: 'project-switch-' + status.turnId,
            turnId: null, tone: status.status === 'failed' ? 'error' : 'info',
            text: `Project switch ${status.status}: ${status.projectPath}${status.error ? '. ' + status.error : ''}` } }
        } satisfies ChatWorkspaceEvent)
      }
    })
    this.catalog = new PeerChatCatalog(store, () => this.workspace(), (fn) => this.withAwake(this.selectedPaneId, fn))
    this.archives = new PeerArchives({
      assertAvailable: () => this.projectSwitch.assertAvailable(),
      cancelSwitch: (reason, chatId) => { this.projectSwitch.cancel(reason, chatId) },
      store,
      attached: (chatId) => this.lifecycle.get(chatId) !== undefined,
      attach: (record) => this.lifecycle.attach(record),
      detach: (chatId) => this.lifecycle.detach(chatId),
      withAwake: (chatId, fn) => this.withAwake(chatId, fn),
      closePeer: (chatId) => this.closePeer(chatId, { keepRecord: true }),
      forgetTranscript: (chatId) => this.transcripts.forget(chatId),
      invalidateCatalog: () => this.catalog.invalidate(),
      emitChats: () => this.emitChats()
    })
    const saved = settings.get()
    this.selectedPaneId = this.lifecycle.restoreOpenChats(saved.chatOpenIds, saved.chatSelectedPaneId, null, null, this.workspace())
    if (saved.chatSelectedPaneId !== this.selectedPaneId || saved.chatOpenIds.join() !== this.lifecycle.ids().join()) {
      void this.persistOpenChats().catch((error: unknown) => {
        console.warn('[chat-peers] could not persist open chats:', error instanceof Error ? error.message : String(error))
      })
    }
    // Only a checkpoint (or thread) change earns a pane event; title, preview, and timestamp
    // writes happen inside turn handling and must not re-enter it.
    store.on('change', (c?: { ids: string[]; checkpointIds?: string[] }) => {
      this.chatsEmit.schedule()
      if (c?.checkpointIds?.length) syncStoreCheckpoint(this.store, this.lifecycle, c.checkpointIds, (p, e) => this.onPaneEvent(p, e))
    })
  }

  snapshot(window?: ChatHistoryWindow): ChatWorkspaceSnapshot {
    const entry = this.lifecycle.require(this.selectedPaneId)
    const selected = entry.surface.snapshot(window)
    return {
      selectedPaneId: this.selectedPaneId,
      chats: this.chatRows(),
      selected: window ? this.rendererView(entry, selected) : selected,
      panes: window ? Object.fromEntries([...new Set([...this.visiblePaneIds, this.selectedPaneId])]
        .flatMap((id) => {
          const peer = this.lifecycle.get(id)
          return peer ? [[id, this.rendererView(peer, peer.surface.snapshot(window))]] : []
        })) : undefined,
      workspace: this.workspaceSelector?.current(),
      preferences: { chatSeamlessRotation: this.settings.get().chatSeamlessRotation }
    }
  }

  /** Earlier messages come from the provider, so a pane showing its cached tail wakes first. */
  async readHistoryPage(paneId: ChatPaneId, threadId: string | null, beforeItemId: string): Promise<ChatHistoryPage> {
    if (typeof beforeItemId !== 'string' || !beforeItemId) throw new Error('Choose a history cursor')
    const snapshot = await this.withAwake(paneId, async (surface) => surface.snapshot({ beforeItemId, limit: CHAT_TURN_PAGE_SIZE, unit: 'turn' }))
    if (snapshot.threadId !== threadId) throw new Error('The chat changed while loading history')
    return { items: snapshot.items, hasEarlier: snapshot.history?.hasEarlier ?? false }
  }

  /** One pane's live snapshot without waking a parked peer; null for an unknown pane. */
  paneSnapshot(paneId: ChatPaneId): ChatSnapshot | null {
    return this.lifecycle.get(paneId)?.surface.snapshot() ?? null
  }

  readonly modelSettings = { selectedHub: (): ReturnType<typeof hubForSelectedPane> => hubForSelectedPane(this.lifecycle, this.selectedPaneId),
    refresh: (): void => { refreshPaneModelPickers(this.lifecycle) } }

  async start(): Promise<void> {
    // The chat the user left is on screen before any provider runs: its saved view paints now,
    // and the replay below replaces it.
    await this.transcripts.load(this.selectedPaneId)
    this.emitWorkspace()
    void this.transcripts.prune(new Set(this.store.ids())).catch((error: unknown) => {
      console.warn('[chat-peers] could not prune saved transcripts:', error instanceof Error ? error.message : String(error))
    })
    // Persisted panes are history, not live work. Warming every one creates an app-server per
    // pane after each relaunch; the selected pane is the only surface startup needs immediately.
    await this.wake(this.selectedPaneId)
    await this.trimAttached()
  }

  stop(): void {
    this.archives.stop()
    this.projectChanges.stop()
    this.projectSwitch.stop()
    // A turn that ended just before quit has a `chats` update waiting; deliver it so the row moves.
    this.chatsEmit.flush()
    // Each attached pane saves what it is showing, so the next launch paints it without a replay.
    for (const entry of this.lifecycle.peers.values()) this.rememberTranscript(entry)
    this.lifecycle.detachAll()
  }

  async send(paneId: ChatPaneId, text: string, attachments: ChatAttachment[]): Promise<void> {
    this.projectSwitch.assertAvailable()
    await this.projectChanges.flush(paneId)
    this.projectSwitch.cancel('A new message superseded the queued continuation', paneId)
    const entry = this.lifecycle.require(paneId)
    const cancelTiming = text.trim() || attachments.length
      ? traceLog.responses.begin({ paneId, provider: entry.display.current.provider, turnId: null })
      : null
    try {
      await this.withAwake(paneId, (surface) => surface.send(text, attachments))
      if (text.trim() || attachments.length) this.store.update(paneId, { messageSentAt: Date.now() })
      wireCoordinatorAfterSend(this.supportHost().coordinatorBridge, paneId, text, attachments)
    } catch (error) {
      cancelTiming?.()
      throw error
    }
  }

  async interrupt(paneId: ChatPaneId): Promise<void> {
    this.projectSwitch.cancel('The requesting chat was stopped', paneId)
    this.cancelPaneWork(paneId)
    await this.withAwake(paneId, (surface) => surface.interrupt())
  }

  async selectPane(paneId: ChatPaneId): Promise<void> {
    this.projectSwitch.assertAvailable()
    this.lifecycle.require(paneId)
    if (paneId === this.selectedPaneId) return
    const previousPaneId = this.selectedPaneId
    this.selectedPaneId = paneId
    // A blank chat the user clicked away from never became one; keep it and the drawer fills
    // with "New chat" rows. One mid-open (busy) is not blank, it is about to hold a thread.
    if (this.lifecycle.peers.size > 1 && !this.visiblePaneIds.has(previousPaneId) && !this.retainedTabIds.has(previousPaneId)) this.lifecycle.discardIfBlank(previousPaneId)
    this.parking.schedule(previousPaneId)
    // Paint the destination from the view it already holds — the live snapshot when its runtime
    // is up, the saved one when it is parked — before waking it. Waking replays the thread from
    // the provider's store and starts a CLI process; awaiting that here kept the pane on the
    // previous chat for the whole start-up. The wake emits its own `replace` when it lands.
    await this.transcripts.load(paneId)
    this.emitWorkspace()
    await this.persistOpenChats()
    this.scheduleWarm(paneId)
    this.wakeLater(paneId, 'wake pane')
  }

  /** Register the renderer's tiles without changing focus or stopping hidden turns. */
  async setVisiblePanes(cwd: string, paneIds: ChatPaneId[], retainedTabIds: ChatPaneId[] = []): Promise<void> {
    if (cwd !== this.workspace().cwd) return
    if (!Array.isArray(paneIds) || paneIds.length > 32 || paneIds.some((id) => typeof id !== 'string')) {
      throw new Error('Choose up to 32 visible chats')
    }
    const records = [...new Set(paneIds)].map((id) => this.store.get(id))
    if (records.some((record) => !record || record.archived)) {
      throw new Error('A visible chat is no longer available')
    }
    if (!Array.isArray(retainedTabIds) || retainedTabIds.some((id) => {
      const record = typeof id === 'string' ? this.store.get(id) : null
      return !record || record.archived
    })) throw new Error('A chat tab is no longer available')
    const revision = ++this.visibilityRevision
    this.visiblePaneIds = new Set(paneIds)
    // Retain empty tabs without waking them or subscribing to their token stream.
    this.retainedTabIds = new Set(retainedTabIds)
    for (const record of records) if (record) this.lifecycle.attach(record)
    await Promise.all(paneIds.map((id) => this.transcripts.load(id)))
    if (revision !== this.visibilityRevision || cwd !== this.workspace().cwd) return
    this.emitWorkspace()
    await this.persistOpenChats()
    if (revision !== this.visibilityRevision || cwd !== this.workspace().cwd) return
    for (const id of paneIds) this.wakeLater(id, 'show chat')
  }

  /** Read the pane's provider plan usage now; the hover card asks each time it opens. */
  async refreshPlanUsage(paneId: ChatPaneId): Promise<void> {
    await this.withAwake(paneId, (surface) => surface.refreshPlanUsage())
  }

  /**
   * A model pick is a UI act: it never waits for a runtime. A parked chat takes it on its saved
   * state (the hub records the pick for the provider to read when it starts), so the picker is
   * as fast on a chat whose process is gone as on one that is running.
   */
  async selectModel(paneId: ChatPaneId, modelId: string): Promise<void> {
    this.projectSwitch.assertAvailable()
    await this.lifecycle.require(paneId).surface.selectModel(modelId)
  }

  async selectReasoningEffort(paneId: ChatPaneId, effort: string): Promise<void> {
    this.projectSwitch.assertAvailable()
    await this.lifecycle.require(paneId).surface.selectReasoningEffort(effort)
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

  async newPeer(callerPaneId?: ChatPaneId): Promise<ChatPaneId> {
    this.projectSwitch.assertAvailable()
    if (callerPaneId) {
      const caller = this.store.get(callerPaneId)
      if (caller?.coordinatorGroup?.role === 'coordinator') {
        return this.coordinatorWorkerPeer(callerPaneId)
      }
    }
    const current = this.lifecycle.require(this.selectedPaneId).surface.snapshot({ limit: 0 })
    return this.newChat(current.selectedModel, current.selectedReasoningEffort, null)
  }

  async openCoordinatorWorkspace(): Promise<OpenCoordinatorWorkspaceResult> {
    return openCoordinatorWorkspace(this.coordinatorHost())
  }

  async enableCoordinator(paneId: ChatPaneId): Promise<EnableCoordinatorResult> {
    return enableCoordinator(this.coordinatorHost(), paneId)
  }

  private coordinatorHost(): PeerCoordinatorHost {
    return {
      store: this.store,
      assertAvailable: () => this.projectSwitch.assertAvailable(),
      modelOf: (paneId) => {
        const current = this.lifecycle.require(paneId).surface.snapshot({ limit: 0 })
        return { modelId: current.selectedModel, reasoningEffort: current.selectedReasoningEffort }
      },
      selectedPaneId: () => this.selectedPaneId,
      createSeeded: (model, seed) =>
        this.newChat(model.modelId, model.reasoningEffort, null, this.workspace(), { selectPane: false, seed }),
      retainPane: (paneId) => {
        if (!this.lifecycle.get(paneId)) this.lifecycle.attach(this.store.require(paneId))
        this.visiblePaneIds.add(paneId)
      },
      selectPane: (paneId) => this.selectPane(paneId),
      settle: async () => {
        await this.persistOpenChats()
        await this.trimAttached()
        this.emitWorkspace()
      }
    }
  }

  stopCoordinatorCrew(paneId?: ChatPaneId): Promise<void> {
    return stopCoordinatorCrewForManager(this.store, paneId, (id) => this.interrupt(id), (id) => this.lifecycle.isRunning(id))
  }

  async disableCoordinator(paneId: ChatPaneId): Promise<void> {
    await haltCoordinatorCrew(this.store, paneId, (id) => this.interrupt(id), (id) => this.lifecycle.isRunning(id)).catch(() => {})
    const groupId = this.store.get(paneId)?.coordinatorGroup?.id
    if (!groupId) return
    for (const member of groupMembers(this.store, groupId)) this.store.update(member.id, { coordinatorGroup: null })
    this.emitWorkspace()
  }

  async restoreCoordinatorFocus(callerPaneId: ChatPaneId, workerPaneId: ChatPaneId): Promise<void> {
    if (callerPaneId === workerPaneId) return
    const caller = this.store.get(callerPaneId)
    const worker = this.store.get(workerPaneId)
    if (caller?.coordinatorGroup?.role !== 'coordinator') return
    if (worker?.coordinatorGroup?.role !== 'worker' || worker.parentChatId !== callerPaneId) return
    await this.selectPane(callerPaneId)
  }

  private coordinatorWorkerPeer(coordinatorPaneId: ChatPaneId): ChatPaneId {
    const workerId = pickCoordinatorWorker(this.store, coordinatorPaneId, (id) => {
      const entry = this.lifecycle.get(id)
      return entry ? entry.surface.snapshot({ limit: 0 }).activeTurnId !== null : false
    })
    void this.selectPane(coordinatorPaneId)
    return workerId
  }

  private async newChat(modelId: string | null, reasoningEffort: string | null, continuation: ChatContinuation | null,
    selection: ChatWorkspaceSelection = this.store.require(this.selectedPaneId),
    options?: { selectPane?: boolean; seed?: Partial<ChatRecordSeed> }): Promise<ChatPaneId> {
    const previousPaneId = this.selectedPaneId
    const { cwd, projectPath } = selection
    const record = this.store.create({
      cwd,
      projectPath,
      provider: chatProviderOfId(modelId),
      modelId,
      reasoningEffort,
      continuation,
      ...options?.seed
    })
    this.lifecycle.attach(record)
    if (options?.selectPane !== false) this.selectedPaneId = record.id
    this.parking.schedule(previousPaneId)
    this.lifecycle.parkExcessIdle(record.id)
    this.emitWorkspace()
    await this.persistOpenChats()
    await this.trimAttached()
    this.wakeLater(record.id, 'start the new chat')
    return record.id
  }
  async closePeer(paneId: ChatPaneId, options?: { keepRecord?: boolean }): Promise<void> {
    this.projectSwitch.assertAvailable()
    this.projectChanges.cancel(paneId)
    this.projectSwitch.cancel('The requesting chat was closed', paneId)
    if (!this.lifecycle.get(paneId)) return
    const closing = this.lifecycle.require(paneId).surface.snapshot({ limit: 0 })
    if (options?.keepRecord) this.lifecycle.detach(paneId)
    else if (!this.lifecycle.discardIfBlank(paneId)) this.lifecycle.detach(paneId)
    const localIds = this.lifecycle.ids()
    if (localIds.length === 0) {
      // Closing the last chat opens an empty one; it keeps the model the workspace was on
      // rather than dropping back to the first provider's default.
      const { cwd, projectPath } = this.workspace()
      const fresh = this.store.create({
        cwd, projectPath, provider: chatProviderOfId(closing.selectedModel), modelId: closing.selectedModel, reasoningEffort: closing.selectedReasoningEffort
      })
      this.lifecycle.attach(fresh)
      this.selectedPaneId = fresh.id
    } else if (this.selectedPaneId === paneId) {
      this.selectedPaneId = localIds[0]!
    }
    await this.persistOpenChats()
    await this.wake(this.selectedPaneId)
    this.emitWorkspace()
  }
  async continueInNewPeer(source: ChatContinuationSource, modelId: string | null): Promise<ChatPaneId> {
    this.projectSwitch.assertAvailable()
    return continuePeer({
      current: () => this.lifecycle.require(this.selectedPaneId).surface.snapshot(),
      attached: (id) => !!this.lifecycle.get(id),
      snapshot: (id) => this.withAwake(id, async (surface) => surface.snapshot()),
      record: (id) => this.store.get(id) ?? undefined,
      readThread: (id) => this.withAwake(this.selectedPaneId, (surface) => surface.readThread(id)),
      create: (model, effort, continuation, selection) => this.newChat(model, effort, continuation, selection)
    }, source, modelId)
  }
  async openChat(chatId: string): Promise<ChatPaneId> {
    this.projectSwitch.assertAvailable()
    const record = this.store.get(chatId)
    if (!record || record.archived) throw new Error('That chat is no longer available')
    if (this.lifecycle.get(chatId)) {
      await this.selectPane(chatId)
      return chatId
    }
    // A blank selected chat is replaced, so reading history from a fresh "New chat" does not leave
    // that empty pane behind; anything else keeps its conversation and the chat opens beside it.
    const previousPaneId = this.selectedPaneId
    this.lifecycle.attach(record)
    this.selectedPaneId = chatId
    // The chat's last known messages, model, and context reading paint now; the provider's
    // replay lands behind them rather than in front of an empty pane.
    await this.transcripts.load(chatId)
    if (this.lifecycle.peers.size > 1 && !this.visiblePaneIds.has(previousPaneId) && !this.retainedTabIds.has(previousPaneId)) this.lifecycle.discardIfBlank(previousPaneId)
    this.parking.schedule(previousPaneId)
    this.lifecycle.parkExcessIdle(chatId)
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

  async setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    if (typeof pinned !== 'boolean') throw new Error('Pinned must be a boolean')
    const record = this.store.get(chatId)
    if (!record || record.archived) throw new Error('That chat is no longer available')
    this.store.update(chatId, { pinnedAt: pinned ? record.pinnedAt ?? Date.now() : null })
    this.emitChats()
  }

  async renameChat(chatId: string, title: string | null): Promise<void> {
    this.lifecycle.rename(chatId, title)
    this.emitChats()
  }

  async retryChatTitle(chatId: string): Promise<void> {
    await this.lifecycle.retryTitle(chatId, (fn) => this.withAwake(chatId, fn))
    this.emitChats()
  }

  async archiveChat(chatId: string): Promise<void> {
    return this.archives.archive(chatId)
  }

  async unarchiveChat(chatId: string): Promise<void> {
    return this.archives.unarchive(chatId)
  }

  /** Tests and the undo window expiry use this to finish a deferred provider archive. */
  flushPendingArchives(): Promise<void> {
    return this.archives.flush()
  }

  async archiveThread(threadId: string): Promise<void> {
    const record = this.store.findByThreadId(threadId)
    if (record) return this.archives.commit(record.id)
    await this.withAwake(this.selectedPaneId, (surface) => surface.archiveThread(threadId))
    this.catalog.invalidate()
    this.emitChats()
  }

  compactConversation(paneId: ChatPaneId): Promise<void> {
    return this.withAwake(paneId, (surface) => surface.compactConversation())
  }

  selectChatProject(paneId: ChatPaneId, projectPath: string | null): Promise<void> {
    this.projectSwitch.assertAvailable()
    this.projectSwitch.cancel('A folder was selected for the requesting chat', paneId)
    return this.projectChanges.request(paneId, projectPath)
  }

  /** Select a directory without changing the working directory or lifetime of existing chats. */
  async selectProject(projectPath: string | null, deferred = false): Promise<void> {
    if (this.selectingProject) throw new Error('A project selection is already in progress')
    this.selectingProject = true
    try {
      if (!deferred) {
        this.projectSwitch.assertAvailable()
        this.projectSwitch.cancel('A manual project selection superseded the queued switch')
      }
      if (!this.workspaceSelector) throw new Error('Project selection is unavailable')
      const current = this.lifecycle.require(this.selectedPaneId).surface.snapshot({ limit: 0 })
      const selection = this.workspaceSelector.current()
      if (selection.projectPath === projectPath) return

      await this.workspaceSelector.select(projectPath, {
        modelId: current.selectedModel,
        reasoningEffort: current.selectedReasoningEffort
      })

      this.visibilityRevision += 1
      this.visiblePaneIds.clear()
      this.retainedTabIds.clear()
      this.catalog.invalidate()
      const restored = this.settings.get()
      this.selectedPaneId = this.lifecycle.restoreOpenChats(restored.chatOpenIds, restored.chatSelectedPaneId, current.selectedModel, current.selectedReasoningEffort, this.workspace())
      this.lifecycle.parkExcessIdle(this.selectedPaneId)
      await this.trimAttached()
      await this.persistOpenChats()
      this.emitWorkspace()
      this.wakeLater(this.selectedPaneId, 'start the project chat')
    } finally {
      this.selectingProject = false
    }
  }

  beginLogin(): Promise<string | null> {
    return this.withAwake(this.selectedPaneId, (surface) => surface.beginLogin())
  }

  listReadable(callerPaneId: string | null): ChatPeerSummary[] {
    return peerManagerListReadable(this.supportHost(), callerPaneId)
  }

  readReadable(chatId: string, callerPaneId: string | null, options: PeerChatReadOptions): Promise<PeerChatReadResult | null> {
    return peerManagerReadReadable(this.supportHost(), chatId, callerPaneId, options)
  }

  private supportHost(): PeerManagerSupportHost {
    return {
      lifecycle: this.lifecycle,
      store: this.store,
      settings: this.settings,
      projectSwitch: this.projectSwitch,
      projectChanges: this.projectChanges,
      transcripts: this.transcripts,
      parking: this.parking,
      catalog: this.catalog,
      chatsEmit: this.chatsEmit,
      browserAssignmentIdle: this.browserAssignmentIdle,
      paneOperations: this.paneOperations,
      workspaceSelector: this.workspaceSelector,
      selectedPaneId: () => this.selectedPaneId,
      visiblePaneIds: () => this.visiblePaneIds,
      retainedTabIds: () => this.retainedTabIds,
      emitWorkspaceEvent: (event) => { this.emit('event', event) },
      coordinatorBridge: { store: this.store, send: (paneId, text, attachments) => this.send(paneId, text, attachments),
        lifecycle: this.lifecycle, crewInternalSend: this.crewInternalSend }
    }
  }

  private workspace(): ChatWorkspaceSelection {
    return peerManagerWorkspace(this.supportHost())
  }

  private async trimAttached(): Promise<void> {
    await peerManagerTrimAttached(this.supportHost())
  }

  private async persistOpenChats(): Promise<void> {
    await peerManagerPersistOpenChats(this.supportHost())
  }

  private wake(paneId: ChatPaneId): Promise<PeerEntry> {
    return peerManagerWake(this.supportHost(), paneId)
  }

  private scheduleWarm(paneId: ChatPaneId): void {
    peerManagerScheduleWarm(this.supportHost(), paneId)
  }

  private wakeLater(paneId: ChatPaneId, what: string): void {
    peerManagerWakeLater(this.supportHost(), paneId, what)
  }

  private rendererView(entry: PeerEntry, snapshot: ChatSnapshot): ChatSnapshot {
    return peerManagerRendererView(this.supportHost(), entry, snapshot)
  }

  private rememberTranscript(entry: PeerEntry): void {
    peerManagerRememberTranscript(this.supportHost(), entry)
  }

  private onPaneEvent(entry: PeerEntry, event: ChatEvent): void {
    peerManagerOnPaneEvent(this.supportHost(), entry, event)
  }

  private async withAwake<T>(paneId: ChatPaneId, action: (surface: ChatSurface) => Promise<T>, deferred = false): Promise<T> {
    return peerManagerWithAwake(this.supportHost(), paneId, action, deferred)
  }

  private chatRows(): ChatRowSummary[] {
    return peerManagerChatRows(this.supportHost())
  }

  private emitWorkspace(): void {
    peerManagerEmitWorkspace(this.supportHost(), this.snapshot({ limit: CHAT_TURN_PAGE_SIZE, unit: 'turn' }))
  }

  private emitChats(): void {
    peerManagerEmitChats(this.supportHost())
  }
}
