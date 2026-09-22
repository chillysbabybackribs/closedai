import type { ChatEvent, ChatSnapshot } from '../../shared/chat.js'
import type { ChatPaneId, ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import { traceLog } from '../trace/trace-log.js'
import type { PeerEntry } from './peer-lifecycle.js'
import type { BrowserAssignmentIdleRelease } from '../tools/browser/assignment-idle-release.js'
import type { PeerIdleParking } from './peer-idle-parking.js'
import type { PeerProjectChanges } from './peer-project.js'
import type { PeerChatCatalog } from './peer-chat-catalog.js'
import type { PeerEmitThrottle } from './peer-events.js'
import type { PeerLifecycle } from './peer-lifecycle.js'

export function handlePeerPaneEvent(options: {
  paneId: ChatPaneId
  entry: PeerEntry
  event: ChatEvent
  lifecycle: PeerLifecycle
  parking: PeerIdleParking
  catalog: PeerChatCatalog
  projectChanges: PeerProjectChanges
  chatsEmit: PeerEmitThrottle
  browserAssignmentIdle?: BrowserAssignmentIdleRelease | null
  rendererView: (entry: PeerEntry, snapshot: ChatSnapshot) => ChatSnapshot
  rememberTranscript: (entry: PeerEntry) => void
  emit: (event: ChatWorkspaceEvent) => void
}): void {
  const {
    paneId, entry, event, lifecycle, parking, catalog, projectChanges, chatsEmit, browserAssignmentIdle,
    rendererView, rememberTranscript, emit
  } = options
  traceLog.responses.event(paneId, event)
  if (event.type !== 'title' && event.type !== 'checkpoint') entry.updatedAt = Date.now()
  const oldTitle = entry.display.current.title
  const oldPreview = entry.display.current.preview
  const wasRunning = entry.display.current.running
  entry.display.update(event, entry.updatedAt)
  const rendererEvent = event.type === 'replace'
    ? { ...event, snapshot: rendererView(entry, event.snapshot) }
    : event
  emit({ type: 'pane', paneId, event: rendererEvent })
  chatsEmit.schedule()
  const running = entry.display.current.running
  const turnBoundary = wasRunning !== running
  if (turnBoundary || entry.display.current.title !== oldTitle || (event.type === 'item' && entry.display.current.preview !== oldPreview)) {
    lifecycle.rememberDisplay(paneId, entry.display.current, entry.updatedAt, turnBoundary ? wasRunning && !running : null)
  }
  if (turnBoundary && !running) catalog.invalidate()
  if ((turnBoundary && !running) || (event.type === 'context' && !running) ||
    (event.type === 'replace' && event.snapshot.items.length > 0)) {
    rememberTranscript(entry)
  }
  if (running) {
    parking.cancel(entry)
    browserAssignmentIdle?.cancel(paneId)
  } else {
    parking.schedule(paneId)
    browserAssignmentIdle?.schedule(paneId, () =>
      Boolean(entry.surface.snapshot({ limit: 0 }).pausedTurnId) || Boolean(entry.surface.hasRunningBackground?.()))
  }
  projectChanges.observe(paneId)
}
