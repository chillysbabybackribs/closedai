import { readFile } from 'node:fs/promises'
import { writeAtomic } from '../atomic-write.js'

// Detached windows that should come back at the next launch (or when their project is selected
// again). Placement is not stored here: Electron persists each window's bounds, display and
// maximized state under its window name. This file only says which windows exist, for which
// project, and which chats they held.

export type AppWindowRecord = {
  id: string
  cwd: string
  tabIds: string[]
}

type PersistedAppWindows = {
  version: 1
  windows: AppWindowRecord[]
}

const WRITE_DEBOUNCE_MS = 250
const MAX_WINDOWS = 16
const MAX_TABS = 64

export class AppWindowStore {
  private writeQueue: Promise<void> = Promise.resolve()
  private writeTimer: ReturnType<typeof setTimeout> | null = null

  private constructor(private readonly filePath: string | null, private records: AppWindowRecord[]) {}

  static async open(filePath: string): Promise<AppWindowStore> {
    return new AppWindowStore(filePath, await readRecords(filePath))
  }

  static inMemory(records: AppWindowRecord[] = []): AppWindowStore {
    return new AppWindowStore(null, records.map(copy))
  }

  list(): AppWindowRecord[] {
    return this.records.map(copy)
  }

  put(record: AppWindowRecord): void {
    const next = copy(record)
    const index = this.records.findIndex((entry) => entry.id === record.id)
    if (index >= 0) this.records[index] = next
    else this.records = [...this.records, next].slice(-MAX_WINDOWS)
    this.scheduleWrite()
  }

  remove(id: string): void {
    const next = this.records.filter((entry) => entry.id !== id)
    if (next.length === this.records.length) return
    this.records = next
    this.scheduleWrite()
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
      this.enqueueWrite()
    }
    await this.writeQueue
  }

  private scheduleWrite(): void {
    if (!this.filePath || this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.enqueueWrite()
    }, WRITE_DEBOUNCE_MS)
    this.writeTimer.unref?.()
  }

  private enqueueWrite(): void {
    const filePath = this.filePath
    if (!filePath) return
    const contents = JSON.stringify({ version: 1, windows: this.records } satisfies PersistedAppWindows)
    this.writeQueue = this.writeQueue
      .then(() => writeAtomic(filePath, contents))
      .catch((error: unknown) => {
        console.warn('[windows] could not save detached windows:', error instanceof Error ? error.message : String(error))
      })
  }
}

function copy(record: AppWindowRecord): AppWindowRecord {
  return { id: record.id, cwd: record.cwd, tabIds: [...record.tabIds] }
}

async function readRecords(filePath: string): Promise<AppWindowRecord[]> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return []
  }
  const windows = (raw as Partial<PersistedAppWindows> | null)?.windows
  if (!Array.isArray(windows)) return []
  return windows.flatMap((entry: unknown) => {
    const record = entry as Partial<AppWindowRecord> | null
    if (!record || typeof record.id !== 'string' || !record.id || typeof record.cwd !== 'string' || !record.cwd) return []
    const tabIds = Array.isArray(record.tabIds)
      ? record.tabIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, MAX_TABS)
      : []
    return [{ id: record.id, cwd: record.cwd, tabIds }]
  }).slice(-MAX_WINDOWS)
}
