import { EventEmitter } from 'node:events'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { ProjectWorkspaceEvent } from '../../shared/project/events.js'
import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import { ProjectStore } from './project-store.js'

export class ProjectHub extends EventEmitter {
  private readonly stores = new Map<string, Promise<ProjectStore>>()

  async snapshot(projectPath: string): Promise<ProjectSnapshot> {
    const store = await this.load(projectPath)
    return store.snapshot()
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.stores.values()].map(async (pending) => (await pending).flush()))
  }

  private async load(projectPath: string): Promise<ProjectStore> {
    const resolved = resolve(projectPath)
    const info = await stat(resolved).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`Project path is not a directory: ${resolved}`)
    let pending = this.stores.get(resolved)
    if (!pending) {
      pending = ProjectStore.open(resolved).then((store) => {
        store.on('change', (change) => {
          this.emit('event', { type: 'snapshot', projectPath: change.projectPath, snapshot: change.snapshot } satisfies ProjectWorkspaceEvent)
        })
        return store
      })
      this.stores.set(resolved, pending)
    }
    return pending
  }
}
