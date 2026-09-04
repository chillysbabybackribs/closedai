import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeAtomic } from '../atomic-write.js'

// ACP has no verb for hiding or deleting a session, and Cursor's own store is the record of
// what exists — so "archive" here is only ClosedAI's view: a set of session ids the drawer
// stops listing. Kept as one small JSON file next to the app's other provider state, the same
// way the Antigravity lane keeps its archived set, rather than as another settings field.

type ArchiveFile = { archived?: unknown }

export class CursorArchive {
  private cache: Set<string> | null = null

  constructor(private readonly stateDir: string) {}

  private get path(): string {
    return join(this.stateDir, 'archived.json')
  }

  async ids(): Promise<Set<string>> {
    if (this.cache) return this.cache
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as ArchiveFile
      const list = Array.isArray(parsed.archived) ? parsed.archived : []
      this.cache = new Set(list.filter((entry): entry is string => typeof entry === 'string'))
    } catch {
      this.cache = new Set()
    }
    return this.cache
  }

  async add(sessionId: string): Promise<void> {
    const ids = await this.ids()
    if (ids.has(sessionId)) return
    ids.add(sessionId)
    await writeAtomic(this.path, JSON.stringify({ archived: [...ids] }, null, 2))
  }
}
