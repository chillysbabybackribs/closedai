import type { ProjectStoreFile } from './store-file.js'

/** Renderer-facing projection of durable project state for one workspace directory. */
export type ProjectSnapshot = ProjectStoreFile & { projectPath: string }
