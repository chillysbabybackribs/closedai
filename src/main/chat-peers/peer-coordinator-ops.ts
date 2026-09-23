import type { ChatPaneId } from '../../shared/chat-peers.js'
import type { ChatRecordSeed } from '../../shared/chat-store.js'
import type { EnableCoordinatorResult, OpenCoordinatorWorkspaceResult } from '../../shared/coordinator.js'
import type { ChatStore } from '../chat-store/chat-store.js'
import { coordinatorResult, findCoordinatorWorkspace, groupMembers } from './coordinator.js'

/** The manager slice coordinator grouping needs: seeded chat creation, selection, and settling. */
export type PeerCoordinatorHost = {
  store: ChatStore
  assertAvailable: () => void
  /** The pane whose model and effort new group members inherit. */
  modelOf: (paneId: ChatPaneId) => { modelId: string | null; reasoningEffort: string | null }
  selectedPaneId: () => ChatPaneId
  createSeeded: (model: { modelId: string | null; reasoningEffort: string | null }, seed: Partial<ChatRecordSeed>) => Promise<ChatPaneId>
  /** Attach a stored pane and keep it through trim while the workspace opens. */
  retainPane: (paneId: ChatPaneId) => void
  selectPane: (paneId: ChatPaneId) => Promise<void>
  /** Persist open chats, trim attached surfaces, and emit the workspace. */
  settle: () => Promise<void>
}

function retainCoordinatorGroup(host: PeerCoordinatorHost, result: OpenCoordinatorWorkspaceResult): void {
  host.retainPane(result.coordinatorPaneId)
  host.retainPane(result.workerPaneId)
}

/** Dedicated workspace panes always read Coordinator / Worker in the tab strip. */
function normalizeDedicatedWorkspaceLabels(store: ChatStore, result: OpenCoordinatorWorkspaceResult): void {
  store.update(result.coordinatorPaneId, { title: 'Coordinator', titleSource: 'manual' })
  store.update(result.workerPaneId, { title: 'Worker', titleSource: 'manual' })
}

export async function openCoordinatorWorkspace(host: PeerCoordinatorHost): Promise<OpenCoordinatorWorkspaceResult> {
  host.assertAvailable()
  const anchorPaneId = host.selectedPaneId()
  host.retainPane(anchorPaneId)
  const existing = findCoordinatorWorkspace(host.store)
  if (existing) {
    normalizeDedicatedWorkspaceLabels(host.store, existing)
    retainCoordinatorGroup(host, existing)
    await host.settle()
    return existing
  }
  const groupId = crypto.randomUUID()
  const model = host.modelOf(anchorPaneId)
  const coordinatorPaneId = await host.createSeeded(model, {
    coordinatorGroup: { id: groupId, role: 'coordinator', slot: null },
    title: 'Coordinator',
    titleSource: 'manual'
  })
  host.retainPane(coordinatorPaneId)
  const workerPaneId = await host.createSeeded(model, {
    parentChatId: coordinatorPaneId,
    coordinatorGroup: { id: groupId, role: 'worker', slot: 'a' },
    title: 'Worker',
    titleSource: 'manual'
  })
  const created = { groupId, coordinatorPaneId, workerPaneId }
  normalizeDedicatedWorkspaceLabels(host.store, created)
  retainCoordinatorGroup(host, created)
  await host.settle()
  return created
}

export async function enableCoordinator(host: PeerCoordinatorHost, paneId: ChatPaneId): Promise<EnableCoordinatorResult> {
  host.assertAvailable()
  const { store } = host
  const record = store.require(paneId)
  if (record.coordinatorGroup?.role === 'coordinator') {
    const workers = groupMembers(store, record.coordinatorGroup.id)
      .filter((member) => member.coordinatorGroup?.role === 'worker')
      .sort((a, b) => (a.coordinatorGroup!.slot === 'a' ? 0 : 1) - (b.coordinatorGroup!.slot === 'a' ? 0 : 1))
    if (workers.length >= 2) {
      await host.selectPane(paneId)
      return coordinatorResult(paneId, [workers[0]!, workers[1]!])
    }
  }
  const groupId = crypto.randomUUID()
  store.update(paneId, { coordinatorGroup: { id: groupId, role: 'coordinator', slot: null } })
  const model = host.modelOf(paneId)
  const workerA = await host.createSeeded(model, {
    parentChatId: paneId,
    coordinatorGroup: { id: groupId, role: 'worker', slot: 'a' },
    title: 'Worker A',
    titleSource: 'manual'
  })
  const workerB = await host.createSeeded(model, {
    parentChatId: paneId,
    coordinatorGroup: { id: groupId, role: 'worker', slot: 'b' },
    title: 'Worker B',
    titleSource: 'manual'
  })
  await host.selectPane(paneId)
  await host.settle()
  return coordinatorResult(paneId, [store.require(workerA), store.require(workerB)])
}
