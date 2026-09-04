import { isAbsolute, relative, resolve, sep } from 'node:path'
import { readFileSnapshot } from './file-snapshot.js'

export type SourceReadScope = { paneId?: string | null; threadId: string | null; cwd: string }
export type SourceVersion = { path: string; hash: string }
export type SourceReadObservation = SourceVersion & { cwd: string }
export type SourceChanges = {
  checkedAt: string
  checkedFiles: number
  changes: Array<{ path: string; previousHash: string; hash?: string; status: 'changed' | 'missing' | 'unavailable' }>
  omittedChanges: number
}

const MAX_FILES = 32
const MAX_SCOPES = 64
const MAX_CHANGES = 8
const MAX_REPORT_CHARS = 4_000
type SnapshotReader = (path: string, signal?: AbortSignal) => Promise<SourceVersion>

/** Version observations only, never a claim that tool output reached or remains in model context. */
export class SourceReadHistory {
  private readonly scopes = new Map<string, Map<string, string>>()

  constructor(private readonly read: SnapshotReader = readFileSnapshot, private readonly timeoutMs = 250) {}

  remember(scope: SourceReadScope, version: SourceVersion): void {
    const key = scopeKey(scope)
    const path = resolve(version.path)
    const local = relative(resolve(scope.cwd), path)
    if (!key || !isAbsolute(version.path) || !local || local.split(sep)[0] === '..' || isAbsolute(local) ||
      local.length > 500 || !/^sha256:[a-f0-9]{64}$/.test(version.hash)) return
    const files = this.scopes.get(key) ?? new Map<string, string>()
    files.delete(path)
    files.set(path, version.hash)
    while (files.size > MAX_FILES) files.delete(files.keys().next().value!)
    this.scopes.delete(key)
    this.scopes.set(key, files)
    while (this.scopes.size > MAX_SCOPES) this.scopes.delete(this.scopes.keys().next().value!)
  }

  /** Read-only comparison: a failed send never consumes the last observed version. */
  async changes(scope: SourceReadScope): Promise<SourceChanges | null> {
    const key = scopeKey(scope)
    const files = key ? this.scopes.get(key) : undefined
    if (!files?.size) return null
    const entries = [...files].reverse()
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<null>((done) => {
      timer = setTimeout(() => { controller.abort(); done(null) }, this.timeoutMs)
    })
    const work = Promise.all(entries.map(async ([path, previousHash]): Promise<SourceChanges['changes'][number] | null> => {
      const local = relative(resolve(scope.cwd), path)
      try {
        const snapshot = await this.read(path, controller.signal)
        return snapshot.hash === previousHash ? null : { path: local, previousHash, hash: snapshot.hash, status: 'changed' }
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null
        return { path: local, previousHash, status: code === 'ENOENT' ? 'missing' : 'unavailable' }
      }
    })).then((items) => {
      if (controller.signal.aborted || this.scopes.get(key!) !== files) return null
      // A newer read during the check supersedes the old baseline for that path.
      const changes = items.filter((item): item is NonNullable<typeof item> => item !== null)
        .filter((item) => files.get(resolve(scope.cwd, item.path)) === item.previousHash)
      if (!changes.length) return null
      const report: SourceChanges = { checkedAt: new Date().toISOString(), checkedFiles: entries.length, changes: [], omittedChanges: changes.length }
      for (const item of changes.slice(0, MAX_CHANGES)) {
        report.changes.push(item)
        report.omittedChanges--
        if (JSON.stringify(report).length > MAX_REPORT_CHARS) {
          report.changes.pop()
          report.omittedChanges++
          break
        }
      }
      return report
    })
    try { return await Promise.race([work, timeout]) }
    finally { if (timer) clearTimeout(timer) }
  }
}

function scopeKey(scope: SourceReadScope): string | null {
  return scope.paneId && scope.threadId ? JSON.stringify([scope.paneId, scope.threadId, resolve(scope.cwd)]) : null
}
