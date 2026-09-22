import { EventEmitter } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import type { ProjectStoreFile } from '../../shared/project/store-file.js'
import { writeAtomic } from '../atomic-write.js'
import { readStoreFile } from '../store-recovery.js'
import { createDefaultProjectStoreFile } from '../../shared/project/store-file.js'
import { normalizeProjectStoreFile } from './normalize.js'

const WRITE_DELAY_MS = 150

// The store lives inside the user's project, so it keeps itself out of their version control
// the way other tool-state directories do. Written once; a file the user edited is left alone.
async function ensureSelfIgnored(directory: string): Promise<void> {
  try {
    await writeFile(join(directory, '.gitignore'), '*\n', { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export type ProjectStoreChange = { projectPath: string; snapshot: ProjectSnapshot }

export class ProjectStore extends EventEmitter {
  private writeTimer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private dirty = false

  private constructor(
    private readonly projectPath: string,
    private readonly filePath: string | null,
    private data: ProjectStoreFile
  ) {
    super()
  }

  static async open(projectPath: string): Promise<ProjectStore> {
    const resolved = resolve(projectPath)
    const directory = join(resolved, '.closedai')
    const filePath = join(directory, 'project.json')
    await mkdir(directory, { recursive: true })
    await ensureSelfIgnored(directory)
    const parsed = await readStoreFile(filePath, '[project-store]', (text) => JSON.parse(text) as unknown)
    const normalized = parsed ? normalizeProjectStoreFile(parsed) : null
    const data = normalized ?? createDefaultProjectStoreFile()
    const store = new ProjectStore(resolved, filePath, data)
    if (!normalized) store.scheduleWrite()
    return store
  }

  static inMemory(projectPath: string, data: ProjectStoreFile = createDefaultProjectStoreFile()): ProjectStore {
    return new ProjectStore(resolve(projectPath), null, structuredClone(data))
  }

  snapshot(): ProjectSnapshot {
    return { projectPath: this.projectPath, ...structuredClone(this.data) }
  }

  replace(next: ProjectStoreFile): ProjectSnapshot {
    this.data = { ...next, updatedAt: Date.now() }
    this.changed()
    return this.snapshot()
  }

  /** Merge a partial update; the next write persists the full file. */
  patch(patch: Partial<ProjectStoreFile>): ProjectSnapshot {
    this.data = { ...this.data, ...patch, updatedAt: Date.now(), version: this.data.version }
    this.changed()
    return this.snapshot()
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
      this.persist()
    }
    await this.writing
  }

  private changed(): void {
    const snapshot = this.snapshot()
    this.emit('change', { projectPath: this.projectPath, snapshot } satisfies ProjectStoreChange)
    this.scheduleWrite()
  }

  private scheduleWrite(): void {
    if (!this.filePath) return
    this.dirty = true
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.persist()
    }, WRITE_DELAY_MS)
  }

  private persist(): void {
    if (!this.filePath || !this.dirty) return
    this.dirty = false
    const payload = JSON.stringify(this.data, null, 2)
    this.writing = this.writing.then(() => writeAtomic(this.filePath!, payload))
  }
}
