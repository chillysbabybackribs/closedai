import type { ChatAttachment, ChatSnapshot } from '../../shared/chat.js'
import type { ChatPaneId } from '../../shared/chat-peers.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { findCoordinatorWorkspace, groupMembers, pickCoordinatorWorker } from './coordinator.js'
import type { ChatEvent } from '../../shared/chat.js'
import type { PeerEntry, PeerLifecycle } from './peer-lifecycle.js'

export const WORKER_FINISHED_PREFIX = '[Worker finished]'

export type CoordinatorBridgeHost = {
  store: ChatStore
  send: (paneId: ChatPaneId, text: string, attachments: ChatAttachment[]) => Promise<void>
  isRunning: (paneId: ChatPaneId) => boolean
  markInternalSend: (paneId: ChatPaneId) => void
  unmarkInternalSend: (paneId: ChatPaneId) => void
  snapshot: (paneId: ChatPaneId) => ChatSnapshot | null
}

const awaitingReview = new Map<ChatPaneId, boolean>()
const pausedCoordinators = new Set<ChatPaneId>()

export function resetCoordinatorBridgeForTests(): void {
  awaitingReview.clear()
  pausedCoordinators.clear()
}

function coordinatorIdForGroup(store: ChatStore, groupId: string): ChatPaneId | null {
  for (const id of store.ids()) {
    const record = store.get(id)
    if (record?.coordinatorGroup?.id === groupId && record.coordinatorGroup.role === 'coordinator') return id
  }
  return null
}

/** Stop auto handoff and clear pending review; returns coordinator pane id when a crew was found. */
export function pauseCoordinatorCrew(store: ChatStore, paneId: ChatPaneId): ChatPaneId | null {
  const record = store.get(paneId)
  const groupId = record?.coordinatorGroup?.id
  if (!groupId) return null
  const coordinatorId = record.coordinatorGroup?.role === 'coordinator' ? paneId : coordinatorIdForGroup(store, groupId)
  if (!coordinatorId) return null
  pausedCoordinators.add(coordinatorId)
  awaitingReview.set(coordinatorId, false)
  return coordinatorId
}

function crewPaused(coordinatorPaneId: ChatPaneId): boolean {
  return pausedCoordinators.has(coordinatorPaneId)
}

function lastAssistantText(snapshot: ChatSnapshot | null): string {
  if (!snapshot) return ''
  for (let index = snapshot.items.length - 1; index >= 0; index -= 1) {
    const item = snapshot.items[index]!
    if (item.type === 'assistant') return item.text.trim()
  }
  return ''
}

function coordinatorOfWorker(store: ChatStore, workerPaneId: ChatPaneId): ChatPaneId | null {
  const worker = store.get(workerPaneId)
  if (worker?.coordinatorGroup?.role !== 'worker') return null
  const parent = worker.parentChatId
  if (!parent) return null
  const coordinator = store.get(parent)
  if (coordinator?.coordinatorGroup?.role !== 'coordinator') return null
  if (coordinator.coordinatorGroup.id !== worker.coordinatorGroup.id) return null
  return parent
}

/** User typed in Coordinator: start Worker on the same text immediately. */
export async function onCoordinatorUserMessage(
  host: CoordinatorBridgeHost,
  coordinatorPaneId: ChatPaneId,
  text: string
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith(WORKER_FINISHED_PREFIX)) return
  const record = host.store.get(coordinatorPaneId)
  if (record?.coordinatorGroup?.role !== 'coordinator') return
  pausedCoordinators.delete(coordinatorPaneId)
  awaitingReview.set(coordinatorPaneId, false)
  const workerId = pickCoordinatorWorker(host.store, coordinatorPaneId, (id) => host.isRunning(id))
  await host.send(workerId, trimmed, [])
}

/** Worker turn ended: ping Coordinator right away so its next turn starts. */
export async function onWorkerTurnEnded(host: CoordinatorBridgeHost, workerPaneId: ChatPaneId): Promise<void> {
  const coordinatorId = coordinatorOfWorker(host.store, workerPaneId)
  if (!coordinatorId || crewPaused(coordinatorId)) return
  const excerpt = lastAssistantText(host.snapshot(workerPaneId))
  const body = excerpt.length > 0 ? excerpt.slice(0, 12_000) : '(Worker finished with no assistant text yet.)'
  const message =
    `${WORKER_FINISHED_PREFIX}\n\n${body}\n\n` +
    'Review what Worker did. Your reply will be sent to Worker automatically when this turn finishes.'
  awaitingReview.set(coordinatorId, true)
  host.markInternalSend(coordinatorId)
  try {
    await host.send(coordinatorId, message, [])
  } finally {
    host.unmarkInternalSend(coordinatorId)
  }
}

/** Coordinator turn ended after a worker report: send its reply to Worker immediately. */
export async function onCoordinatorTurnEnded(host: CoordinatorBridgeHost, coordinatorPaneId: ChatPaneId): Promise<void> {
  if (!awaitingReview.get(coordinatorPaneId) || crewPaused(coordinatorPaneId)) return
  awaitingReview.set(coordinatorPaneId, false)
  const record = host.store.get(coordinatorPaneId)
  if (record?.coordinatorGroup?.role !== 'coordinator') return
  const instruction = lastAssistantText(host.snapshot(coordinatorPaneId))
  if (!instruction) return
  const workerId = pickCoordinatorWorker(host.store, coordinatorPaneId, (id) => host.isRunning(id))
  await host.send(workerId, instruction, [])
}

export async function onPaneTurnEnded(host: CoordinatorBridgeHost, paneId: ChatPaneId, _entry: PeerEntry): Promise<void> {
  const record = host.store.get(paneId)
  if (record?.coordinatorGroup?.role === 'worker') {
    await onWorkerTurnEnded(host, paneId)
    return
  }
  if (record?.coordinatorGroup?.role === 'coordinator') {
    await onCoordinatorTurnEnded(host, paneId)
  }
}

export type PeerManagerCoordinatorBridge = {
  store: ChatStore
  send: (paneId: ChatPaneId, text: string, attachments: ChatAttachment[]) => Promise<void>
  lifecycle: Pick<PeerLifecycle, 'isRunning' | 'get'>
  crewInternalSend: Set<ChatPaneId>
}

export function coordinatorBridgeHost(manager: PeerManagerCoordinatorBridge): CoordinatorBridgeHost {
  return {
    store: manager.store,
    send: (paneId, text, attachments) => manager.send(paneId, text, attachments),
    isRunning: (paneId) => manager.lifecycle.isRunning(paneId),
    markInternalSend: (paneId) => { manager.crewInternalSend.add(paneId) },
    unmarkInternalSend: (paneId) => { manager.crewInternalSend.delete(paneId) },
    snapshot: (paneId) => manager.lifecycle.get(paneId)?.surface.snapshot({ limit: 40 }) ?? null
  }
}

function logBridgeError(label: string, error: unknown): void {
  console.warn(`[coordinator-bridge] ${label}:`, error instanceof Error ? error.message : String(error))
}

export function wireCoordinatorAfterSend(
  manager: PeerManagerCoordinatorBridge,
  paneId: ChatPaneId,
  text: string,
  attachments: ChatAttachment[]
): void {
  if (manager.crewInternalSend.has(paneId) || !text.trim() || attachments.length > 0) return
  const record = manager.store.get(paneId)
  if (record?.coordinatorGroup?.role !== 'coordinator') return
  void onCoordinatorUserMessage(coordinatorBridgeHost(manager), paneId, text).catch((error) => {
    logBridgeError('delegate to worker failed', error)
  })
}

export async function stopCoordinatorCrew(
  store: ChatStore,
  paneId: ChatPaneId,
  interrupt: (paneId: ChatPaneId) => Promise<void>,
  isRunning: (paneId: ChatPaneId) => boolean
): Promise<boolean> {
  const record = store.get(paneId)
  const groupId = record?.coordinatorGroup?.id
  if (!groupId || !pauseCoordinatorCrew(store, paneId)) return false
  await Promise.all(groupMembers(store, groupId).map(async (member) => {
    if (isRunning(member.id)) await interrupt(member.id)
  }))
  return true
}

export async function stopCoordinatorCrewForManager(
  store: ChatStore,
  paneId: ChatPaneId | undefined,
  interrupt: (paneId: ChatPaneId) => Promise<void>,
  isRunning: (paneId: ChatPaneId) => boolean
): Promise<void> {
  const record = paneId ? store.get(paneId) : null
  const target = record?.coordinatorGroup ? paneId! : findCoordinatorWorkspace(store)?.coordinatorPaneId
  if (!target || !await stopCoordinatorCrew(store, target, interrupt, isRunning)) {
    throw new Error('No coordinator crew is active')
  }
}

export async function disableCoordinatorGroup(
  store: ChatStore,
  paneId: ChatPaneId,
  interrupt: (paneId: ChatPaneId) => Promise<void>,
  isRunning: (paneId: ChatPaneId) => boolean
): Promise<boolean> {
  await stopCoordinatorCrew(store, paneId, interrupt, isRunning).catch(() => {})
  const groupId = store.get(paneId)?.coordinatorGroup?.id
  if (!groupId) return false
  for (const member of groupMembers(store, groupId)) store.update(member.id, { coordinatorGroup: null })
  return true
}

export function wireCoordinatorAfterPaneEvent(
  manager: PeerManagerCoordinatorBridge,
  entry: PeerEntry,
  event: ChatEvent
): void {
  if (event.type !== 'turn' || event.turnId !== null) return
  void onPaneTurnEnded(coordinatorBridgeHost(manager), entry.chatId, entry).catch((error) => {
    logBridgeError('turn handoff failed', error)
  })
}
