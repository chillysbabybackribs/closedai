import type { CoordinatorGroup, EnableCoordinatorResult } from '../../shared/coordinator.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import type { ChatPaneId } from '../../shared/chat-peers.js'
import type { ChatStore } from '../chat-store/chat-store.js'

export function normalizeCoordinatorGroup(value: unknown): CoordinatorGroup | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' && row.id.length > 0 ? row.id : null
  const role = row.role === 'coordinator' || row.role === 'worker' ? row.role : null
  if (!id || !role) return null
  const slot = row.slot === 'a' || row.slot === 'b' ? row.slot : role === 'worker' ? null : null
  if (role === 'worker' && !slot) return null
  if (role === 'coordinator' && row.slot !== null && row.slot !== undefined) return null
  return { id, role, slot: role === 'coordinator' ? null : slot }
}

export function groupMembers(store: ChatStore, groupId: string): ChatRecord[] {
  return [...store.ids()].map((id) => store.get(id)).filter((record): record is ChatRecord =>
    Boolean(record && record.coordinatorGroup?.id === groupId))
}

export function pickCoordinatorWorker(
  store: ChatStore,
  coordinatorPaneId: ChatPaneId,
  running: (paneId: ChatPaneId) => boolean
): ChatPaneId {
  const coordinator = store.require(coordinatorPaneId)
  const groupId = coordinator.coordinatorGroup?.role === 'coordinator' ? coordinator.coordinatorGroup.id : null
  if (!groupId) throw new Error('This chat is not a coordinator')
  const workers = groupMembers(store, groupId).filter((record) => record.coordinatorGroup?.role === 'worker')
  if (workers.length < 2) throw new Error('Coordinator workers are not ready yet')
  const idle = workers.find((worker) => !running(worker.id))
  const chosen = idle ?? workers.find((worker) => worker.coordinatorGroup?.slot === 'a') ?? workers[0]!
  return chosen.id
}

export function coordinatorResult(
  coordinatorPaneId: string,
  workers: [ChatRecord, ChatRecord]
): EnableCoordinatorResult {
  return {
    groupId: workers[0]!.coordinatorGroup!.id,
    coordinatorPaneId,
    workerPaneIds: [workers[0]!.id, workers[1]!.id]
  }
}
