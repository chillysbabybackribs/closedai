import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import type { ProjectCanvasFixture } from '../preview/project-canvas-fixture.js'
import type { DiscoveryState } from '../preview/project-discovery.js'
import type { JournalLine } from '../preview/project-files.js'
import type { TreeNode } from '../preview/project-tree.js'

export type PersistedProjectHydration = {
  discovery: DiscoveryState
  phase: 'intake' | 'canvas'
  tree: TreeNode[]
  journal: JournalLine[]
  confirmedAt: number
  caughtUpAt: number
  acceptedAt: number | null
  skipSimulatedDispatch: boolean
}

export function shouldHydrateFromSnapshot(snapshot: ProjectSnapshot): boolean {
  return snapshot.phase !== 'intake'
    || snapshot.direction.idea.length > 0
    || snapshot.tree.length > 0
    || snapshot.journal.length > 0
}

export function hydrateFromSnapshot(snapshot: ProjectSnapshot): PersistedProjectHydration {
  const canvasPhase = snapshot.phase === 'building' || snapshot.phase === 'closing' || snapshot.phase === 'complete'
  return {
    discovery: { record: snapshot.direction, asking: snapshot.discoveryAsking },
    phase: canvasPhase ? 'canvas' : 'intake',
    tree: snapshot.tree,
    journal: snapshot.journal,
    confirmedAt: snapshot.startedAt ?? snapshot.caughtUpAt ?? snapshot.updatedAt,
    caughtUpAt: snapshot.caughtUpAt,
    acceptedAt: snapshot.acceptedAt,
    skipSimulatedDispatch: snapshot.tree.length > 0
  }
}

export function hydrationToCanvasFixture(hydration: PersistedProjectHydration): ProjectCanvasFixture {
  return {
    discovery: hydration.discovery,
    tree: hydration.tree,
    journal: hydration.journal,
    confirmedAt: hydration.confirmedAt,
    caughtUpAt: hydration.caughtUpAt
  }
}
