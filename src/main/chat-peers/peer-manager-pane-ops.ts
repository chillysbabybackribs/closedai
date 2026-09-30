import type { ChatEvent, ChatSnapshot } from '../../shared/chat.js'
import type { ChatPaneId, ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import type { ChatSurface } from '../chat-hub.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { cachedChatThreadId, CACHED_TRANSCRIPT_ITEMS, type ChatTranscriptCache } from '../chat-store/chat-transcript-cache.js'
import type { ChatMemoryIndex } from '../chat-store/chat-memory-index.js'
import { traceLog } from '../trace/trace-log.js'
import type { BrowserAssignmentIdleRelease } from '../tools/browser/assignment-idle-release.js'
import type { DeferredProjectSwitch } from './deferred-project-switch.js'
import { cachedPaneView, PeerEmitThrottle, rendererSnapshot } from './peer-events.js'
import type { PeerChatCatalog } from './peer-chat-catalog.js'
import type { PeerIdleParking } from './peer-idle-parking.js'
import type { PeerEntry, PeerLifecycle } from './peer-lifecycle.js'
import type { PeerProjectChanges } from './peer-project.js'

export type PeerPaneOpsHost = {
  lifecycle: PeerLifecycle
  parking: PeerIdleParking
  store: ChatStore
  transcripts: ChatTranscriptCache
  memoryIndex: ChatMemoryIndex | null
  projectSwitch: DeferredProjectSwitch
  projectChanges: PeerProjectChanges
  catalog: PeerChatCatalog
  chatsEmit: PeerEmitThrottle
  browserAssignmentIdle: BrowserAssignmentIdleRelease | null
  paneOperations: Map<ChatPaneId, Promise<void>>
  emitWorkspaceEvent: (event: ChatWorkspaceEvent) => void
  assertAvailable: () => void
  wake: (paneId: ChatPaneId) => Promise<PeerEntry>
}

export function peerRendererView(
  store: ChatStore,
  transcripts: ChatTranscriptCache,
  entry: PeerEntry,
  snapshot: ChatSnapshot
): ChatSnapshot {
  const filled = cachedPaneView(snapshot, store.get(entry.chatId), transcripts.peek(entry.chatId))
  return rendererSnapshot(filled, entry.display.current.title)
}

export function rememberPeerTranscript(
  store: ChatStore,
  transcripts: ChatTranscriptCache,
  memoryIndex: ChatMemoryIndex | null,
  entry: PeerEntry
): void {
  const record = store.get(entry.chatId)
  const threadId = cachedChatThreadId(record)
  if (!threadId) return
  transcripts.remember(entry.chatId, threadId, entry.surface.snapshot({ limit: CACHED_TRANSCRIPT_ITEMS, unit: 'item' }))
  if (record && memoryIndex) memoryIndex.upsert(record, entry.surface.snapshot().items)
}

export function handlePeerPaneEvent(host: PeerPaneOpsHost, entry: PeerEntry, event: ChatEvent): void {
  if (event.type === 'item' && event.item.type === 'notice' && event.item.tone === 'error') {
    host.projectSwitch.cancel('The requesting chat reported an error', entry.chatId)
  }
  const paneId = entry.chatId
  traceLog.responses.event(paneId, event)
  if (event.type !== 'title' && event.type !== 'checkpoint') entry.updatedAt = Date.now()
  const oldTitle = entry.display.current.title
  const oldPreview = entry.display.current.preview
  const wasRunning = entry.display.current.running
  entry.display.update(event, entry.updatedAt)
  const rendererEvent = event.type === 'replace'
    ? { ...event, snapshot: peerRendererView(host.store, host.transcripts, entry, event.snapshot) }
    : event
  host.emitWorkspaceEvent({ type: 'pane', paneId, event: rendererEvent })
  host.chatsEmit.schedule()
  const running = entry.display.current.running
  const turnBoundary = wasRunning !== running
  if (turnBoundary || entry.display.current.title !== oldTitle || (event.type === 'item' && entry.display.current.preview !== oldPreview)) {
    host.lifecycle.rememberDisplay(paneId, entry.display.current, entry.updatedAt, turnBoundary ? wasRunning && !running : null)
  }
  if (turnBoundary && !running) host.catalog.invalidate()
  if ((turnBoundary && !running) || (event.type === 'context' && !running) ||
    (event.type === 'replace' && event.snapshot.items.length > 0)) {
    rememberPeerTranscript(host.store, host.transcripts, entry, host.memoryIndex)
  }
  if (running) {
    host.parking.cancel(entry)
    host.browserAssignmentIdle?.cancel(paneId)
  } else {
    host.parking.schedule(paneId)
    host.browserAssignmentIdle?.schedule(paneId, () =>
      Boolean(entry.surface.snapshot({ limit: 0 }).pausedTurnId) || Boolean(entry.surface.hasRunningBackground?.()))
  }
  host.projectChanges.observe(paneId)
}

export async function withSerializedAwake<T>(
  host: PeerPaneOpsHost,
  paneId: ChatPaneId,
  action: (surface: ChatSurface) => Promise<T>,
  deferred = false
): Promise<T> {
  if (!deferred) host.assertAvailable()
  const queued = (host.paneOperations.get(paneId) ?? Promise.resolve()).then(async () => {
    const entry = await host.wake(paneId)
    host.parking.cancel(entry)
    try {
      return await action(entry.surface)
    } finally {
      host.parking.schedule(paneId)
    }
  })
  const tail = queued.then(() => undefined, () => undefined)
  host.paneOperations.set(paneId, tail)
  try {
    return await queued
  } finally {
    if (host.paneOperations.get(paneId) === tail) host.paneOperations.delete(paneId)
  }
}
