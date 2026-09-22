import type { ProjectSnapshot } from './snapshot.js'

export type ProjectWorkspaceEvent = { type: 'snapshot'; projectPath: string; snapshot: ProjectSnapshot }
