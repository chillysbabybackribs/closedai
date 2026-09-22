import type { CoordinatorBinding, HiveConfig } from './coordinator.js'
import type { DirectionRecord } from './direction.js'
import type { TreeNode } from './tree.js'

export type ProjectPhase = 'intake' | 'confirm' | 'building' | 'closing' | 'complete'

/** Durable project state owned by the main process (renderer projects a snapshot). */
export type ProjectRecord = {
  projectPath: string
  phase: ProjectPhase
  direction: DirectionRecord
  coordinator: CoordinatorBinding | null
  hive: HiveConfig
  startedAt: number | null
  acceptedAt: number | null
  /** Intent map nodes; file tree derives from direction + journal + reports. */
  tree: TreeNode[]
}
