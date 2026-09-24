import type { ChatEvent, ChatSnapshot } from '../../shared/chat.js'
import type {
  ChatPaneId,
  ChatPeerSummary,
  ChatRowSummary,
  ChatWorkspaceEvent,
  ChatWorkspaceSnapshot,
  PeerChatReadOptions,
  PeerChatReadResult
} from '../../shared/chat-peers.js'
import { chatRecordIsBlank } from '../../shared/chat-store.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ChatSurface } from '../chat-hub.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import type { ChatTranscriptCache } from '../chat-store/chat-transcript-cache.js'
import type { BrowserAssignmentIdleRelease } from '../tools/browser/assignment-idle-release.js'
import { chatRowSummariesEqual, rowSummary } from './peer-events.js'
import { handlePeerPaneEvent, peerRendererView, rememberPeerTranscript, withSerializedAwake, type PeerPaneOpsHost } from './peer-manager-pane-ops.js'
import type { PeerIdleParking } from './peer-idle-parking.js'
import type { PeerLifecycle, PeerEntry } from './peer-lifecycle.js'
import { listReadablePeers, readReadablePeer, type ReadablePeerHost } from './peer-readable.js'
import { openChatsPatch } from './peer-settings.js'
import { schedulePaneWarm } from './provider-warm.js'
import type { PeerChatCatalog } from './peer-chat-catalog.js'
import type { DeferredProjectSwitch } from './deferred-project-switch.js'
import { PeerProjectChanges } from './peer-project.js'
import type { ChatWorkspaceSelection, ChatWorkspaceSelector } from './peer-workspace.js'
import type { PeerEmitThrottle } from './peer-events.js'
import type { PeerChatRowsCache } from './peer-chat-rows-cache.js'
export type PeerManagerSupportHost = {
  lifecycle: PeerLifecycle
  store: ChatStore
  settings: AppSettingsAccess
  projectSwitch: DeferredProjectSwitch
  projectChanges: PeerProjectChanges
  transcripts: ChatTranscriptCache
  parking: PeerIdleParking
  catalog: PeerChatCatalog
  chatsEmit: PeerEmitThrottle
  browserAssignmentIdle: BrowserAssignmentIdleRelease | null
  paneOperations: Map<ChatPaneId, Promise<void>>
  workspaceSelector?: ChatWorkspaceSelector
  selectedPaneId: () => ChatPaneId
  visiblePaneIds: () => Set<ChatPaneId>
  retainedTabIds: () => Set<ChatPaneId>
  emitWorkspaceEvent: (event: ChatWorkspaceEvent) => void
  chatRowsCache?: PeerChatRowsCache
  /** Skips redundant drawer IPC when throttled emits rebuild the same row summaries. */
  chatRowsEmitState?: { rows: ChatRowSummary[] | null; selectedPaneId: ChatPaneId | null }
}

export function peerManagerReadable(host: PeerManagerSupportHost): ReadablePeerHost {
  return {
    summaries: () => peerManagerSummaries(host),
    live: (paneId) => host.lifecycle.require(paneId).surface.snapshot(),
    record: (paneId) => host.store.get(paneId),
    transcripts: host.transcripts
  }
}

export function peerManagerWorkspace(host: PeerManagerSupportHost): ChatWorkspaceSelection {
  if (host.workspaceSelector) return host.workspaceSelector.current()
  const saved = host.settings.get()
  return { cwd: saved.chatWorkspacePath ?? '', projectPath: saved.chatProjectPath }
}

export async function peerManagerTrimAttached(host: PeerManagerSupportHost): Promise<void> {
  const pending = host.projectSwitch.state()
  const switching = pending && (pending.status === 'pending' || pending.status === 'switching') ? [pending.paneId] : []
  const detached = host.lifecycle.trim([
    host.selectedPaneId(),
    ...host.visiblePaneIds(),
    ...switching
  ])
  if (detached.length === 0) return
  // The detached rows were built while these chats were still attached; rebuild them.
  host.chatRowsCache?.invalidateDetached()
  host.chatsEmit.schedule()
  await peerManagerPersistOpenChats(host)
}

export async function peerManagerPersistOpenChats(host: PeerManagerSupportHost): Promise<void> {
  const records = host.lifecycle.ids().map((id) => host.store.require(id))
  await host.settings.set(openChatsPatch(records, host.store.require(host.selectedPaneId())))
}

export function peerManagerWake(host: PeerManagerSupportHost, paneId: ChatPaneId): Promise<PeerEntry> {
  return host.lifecycle.withBusy(paneId, () => host.parking.wake(paneId) as Promise<PeerEntry>)
}

export function peerManagerScheduleWarm(host: PeerManagerSupportHost, paneId: ChatPaneId): void {
  schedulePaneWarm(paneId, async (target) => {
    if (target !== host.selectedPaneId()) return
    await peerManagerWithAwake(host, target, (surface) => surface.start())
  })
}

export function peerManagerWakeLater(host: PeerManagerSupportHost, paneId: ChatPaneId, what: string): void {
  void peerManagerWake(host, paneId).then(async () => {
    if (paneId !== host.selectedPaneId()
      && !host.visiblePaneIds().has(paneId)
      && !host.retainedTabIds().has(paneId)
      && host.lifecycle.peers.size > 1
      && host.lifecycle.discardIfBlank(paneId)) {
      await peerManagerPersistOpenChats(host)
    }
  }).catch((error: unknown) => {
    console.warn(`[chat-peers] could not ${what}:`, error instanceof Error ? error.message : String(error))
  })
}

export function peerManagerRendererView(host: PeerManagerSupportHost, entry: PeerEntry, snapshot: ChatSnapshot): ChatSnapshot {
  return peerRendererView(host.store, host.transcripts, entry, snapshot)
}

export function peerManagerRememberTranscript(host: PeerManagerSupportHost, entry: PeerEntry): void {
  rememberPeerTranscript(host.store, host.transcripts, entry)
}

export function peerManagerPaneOpsHost(host: PeerManagerSupportHost): PeerPaneOpsHost {
  return {
    lifecycle: host.lifecycle,
    parking: host.parking,
    store: host.store,
    transcripts: host.transcripts,
    projectSwitch: host.projectSwitch,
    projectChanges: host.projectChanges,
    catalog: host.catalog,
    chatsEmit: host.chatsEmit,
    browserAssignmentIdle: host.browserAssignmentIdle,
    paneOperations: host.paneOperations,
    emitWorkspaceEvent: (event) => { host.emitWorkspaceEvent(event) },
    assertAvailable: () => { host.projectSwitch.assertAvailable() },
    wake: (paneId) => peerManagerWake(host, paneId)
  }
}

export function peerManagerOnPaneEvent(host: PeerManagerSupportHost, entry: PeerEntry, event: ChatEvent): void {
  handlePeerPaneEvent(peerManagerPaneOpsHost(host), entry, event)
}

export async function peerManagerWithAwake<T>(
  host: PeerManagerSupportHost,
  paneId: ChatPaneId,
  action: (surface: ChatSurface) => Promise<T>,
  deferred = false
): Promise<T> {
  return withSerializedAwake(peerManagerPaneOpsHost(host), paneId, action, deferred)
}

export function peerManagerSummaries(host: PeerManagerSupportHost): ChatPeerSummary[] {
  return [...host.lifecycle.peers.values()].map((entry) => ({ ...entry.display.current }))
}

export function peerManagerChatRows(host: PeerManagerSupportHost): ChatRowSummary[] {
  if (host.chatRowsCache) return host.chatRowsCache.rows(host)
  return host.store.ids().map((id) => host.store.require(id))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .filter((record) => host.lifecycle.get(record.id) || record.pinnedAt !== null || !chatRecordIsBlank(record))
    .map((record) =>
      ({ ...rowSummary(record, host.lifecycle.get(record.id)?.display.current ?? null),
        pendingProject: host.projectChanges.selection(record.id) }))
}

export function peerManagerEmitWorkspace(host: PeerManagerSupportHost, snapshot: ChatWorkspaceSnapshot): void {
  host.emitWorkspaceEvent({ type: 'workspace', snapshot } satisfies ChatWorkspaceEvent)
}

export function peerManagerEmitChats(host: PeerManagerSupportHost): void {
  const selectedPaneId = host.selectedPaneId()
  const chats = peerManagerChatRows(host)
  const cache = host.chatRowsEmitState
  if (cache?.rows && cache.selectedPaneId === selectedPaneId && chatRowSummariesEqual(cache.rows, chats)) return
  if (cache) {
    cache.rows = chats
    cache.selectedPaneId = selectedPaneId
  }
  host.emitWorkspaceEvent({
    type: 'chats',
    selectedPaneId,
    chats
  } satisfies ChatWorkspaceEvent)
}

export function peerManagerListReadable(host: PeerManagerSupportHost, callerPaneId: string | null): ChatPeerSummary[] {
  return listReadablePeers(peerManagerReadable(host), callerPaneId)
}

export function peerManagerReadReadable(
  host: PeerManagerSupportHost,
  chatId: string,
  callerPaneId: string | null,
  options: PeerChatReadOptions
): Promise<PeerChatReadResult | null> {
  return readReadablePeer(peerManagerReadable(host), chatId, callerPaneId, options)
}
