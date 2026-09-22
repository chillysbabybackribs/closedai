import type { CoordinatorBinding, HiveConfig } from './coordinator.js'
import type { ClaritySlot, DirectionRecord } from './direction.js'
import type { ProjectJournalLine } from './journal.js'
import type { ProjectPhase } from './record.js'
import type { TreeNode } from './tree.js'

export const PROJECT_STORE_VERSION = 1 as const

export type ProjectStoreFile = {
  version: typeof PROJECT_STORE_VERSION
  updatedAt: number
  phase: ProjectPhase
  direction: DirectionRecord
  /** Which discovery slot is open during intake; null when direction is complete or in confirm/build. */
  discoveryAsking: ClaritySlot | null
  coordinator: CoordinatorBinding | null
  hive: HiveConfig
  startedAt: number | null
  acceptedAt: number | null
  caughtUpAt: number
  tree: TreeNode[]
  journal: ProjectJournalLine[]
}
