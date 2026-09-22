// The workspace renders a store file; nothing about the project lives only in React state.
// This module is the one mapping from the durable shape to what the components consume, plus
// the reverse for the canvas fixture so previews and tests feed the same path as the live app.
import { createDefaultProjectStoreFile, type ProjectStoreFile } from '../../shared/project/store-file.js'
import type { ProjectCanvasFixture } from './project-canvas-fixture.js'
import type { DiscoveryState } from './project-discovery.js'
import type { JournalLine } from './project-files.js'
import type { TreeNode } from './project-tree.js'

export type ProjectView = {
  discovery: DiscoveryState
  phase: 'intake' | 'canvas'
  tree: TreeNode[]
  journal: JournalLine[]
  /** When the direction was confirmed and the build started; 0 before that. */
  confirmedAt: number
  caughtUpAt: number
  acceptedAt: number | null
}

export function projectView(file: ProjectStoreFile): ProjectView {
  const canvas = file.phase === 'building' || file.phase === 'closing' || file.phase === 'complete'
  return {
    discovery: { record: file.direction, asking: file.discoveryAsking },
    phase: canvas ? 'canvas' : 'intake',
    tree: file.tree,
    journal: file.journal,
    confirmedAt: file.startedAt ?? 0,
    caughtUpAt: file.caughtUpAt,
    acceptedAt: file.acceptedAt
  }
}

/** A pre-built canvas as a store file, so a fixture enters the component the same way disk state does. */
export function fixtureStoreFile(fixture: ProjectCanvasFixture, now = Date.now()): ProjectStoreFile {
  return {
    ...createDefaultProjectStoreFile(now),
    phase: 'building',
    direction: fixture.discovery.record,
    discoveryAsking: fixture.discovery.asking,
    startedAt: fixture.confirmedAt,
    caughtUpAt: fixture.caughtUpAt,
    tree: fixture.tree,
    journal: fixture.journal
  }
}
