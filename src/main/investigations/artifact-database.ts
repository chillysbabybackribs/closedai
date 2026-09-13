import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { ArtifactDescriptor, ArtifactLimits, ArtifactRead, ArtifactScope } from '../../shared/investigation-artifacts.js'
import { DEFAULT_ARTIFACT_LIMITS } from '../../shared/investigation-artifacts.js'

export type ArtifactRequest = {
  action: 'reserve' | 'complete' | 'import' | 'list' | 'read' | 'export' | 'delete' | 'close'
  scope: ArtifactScope
  input: Record<string, unknown>
  cancellation: SharedArrayBuffer
}

type Row = { id: string; hash: string; size: number; label: string; media_type: string; created_at: string }
export const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** All synchronous filesystem, hashing, JSON projection and SQLite work lives in a worker. */
export class ArtifactDatabase {
  private readonly db: DatabaseSync

  constructor(file: string, private readonly limits: ArtifactLimits = DEFAULT_ARTIFACT_LIMITS) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    try {
      const fd = openSync(file, 'wx', 0o600)
      closeSync(fd)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (!lstatSync(file).isFile()) throw new Error('Invalid artifact database file')
    }
    chmodSync(file, 0o600)
    this.db = new DatabaseSync(file)
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
      if (version > 1) throw new Error('Artifact database requires a newer application')
      this.db.exec(`
        PRAGMA busy_timeout=5000;
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS blobs(scope TEXT, hash TEXT, data BLOB NOT NULL, PRIMARY KEY(scope,hash));
        CREATE TABLE IF NOT EXISTS artifacts(
          id TEXT PRIMARY KEY, scope TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL,
          label TEXT NOT NULL, media_type TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(scope,hash) REFERENCES blobs(scope,hash));
        CREATE INDEX IF NOT EXISTS artifacts_scope ON artifacts(scope,id);
        CREATE TABLE IF NOT EXISTS operations(
          scope TEXT, key TEXT, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
          artifact_id TEXT, PRIMARY KEY(scope,key));
        PRAGMA user_version=1;
      `)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  run(request: ArtifactRequest): unknown {
    const flag = new Int32Array(request.cancellation)
    if (Atomics.load(flag, 0) === 1) throw new Error('Artifact operation cancelled')
    if (request.action === 'close') {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      this.db.close()
      return { closed: true }
    }
    const scope = digest(JSON.stringify([
      field(request.scope.workspace, 'workspace', 4096), field(request.scope.chatId, 'chat', 256)
    ]))
    const input = request.input
    switch (request.action) {
      case 'reserve': return this.reserve(scope, input, flag)
      case 'complete': return this.complete(scope, input, flag)
      case 'import': return this.importFile(scope, input, flag)
      case 'list': return this.list(scope, input)
      case 'read': return this.read(scope, input)
      case 'export': return this.exportFile(scope, input, flag)
      case 'delete': return this.remove(scope, input, flag)
    }
  }

  private transaction<T>(flag: Int32Array, operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      // 0 active, 1 cancelled, 2 commit admitted. Cancellation cannot undo admitted writes.
      if (Atomics.compareExchange(flag, 0, 0, 2) !== 0) throw new Error('Artifact operation cancelled before commit')
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private reserve(scope: string, input: Record<string, unknown>, flag: Int32Array): unknown {
    const key = field(input.key, 'operation key', 256)
    const fingerprint = field(input.fingerprint, 'request fingerprint', 64)
    return this.transaction(flag, () => {
      const existing = this.db.prepare('SELECT * FROM operations WHERE scope=? AND key=?').get(scope, key)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error('Operation key already belongs to a different request')
        if (existing.status !== 'complete') throw new Error(`Operation is ${existing.status}; it will not execute again. Inspect effects before using a new key.`)
        return { state: 'complete', artifact: descriptor(this.row(scope, String(existing.artifact_id))) }
      }
      const count = Number(this.db.prepare('SELECT count(*) AS n FROM operations WHERE scope=?').get(scope)?.n)
      const total = Number(this.db.prepare('SELECT count(*) AS n FROM operations').get()?.n)
      if (count >= this.limits.operationsPerScope || total >= 100_000) throw new Error('Artifact operation receipt quota exceeded')
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,NULL)').run(scope, key, fingerprint, 'uncertain')
      return { state: 'reserved' }
    })
  }

  private complete(scope: string, input: Record<string, unknown>, flag: Int32Array): ArtifactDescriptor {
    const bytes = input.bytes
    if (!(bytes instanceof Uint8Array)) throw new Error('Artifact bytes required')
    if (bytes.byteLength > this.limits.artifactBytes) throw new Error('Artifact byte quota exceeded')
    const key = field(input.key, 'operation key', 256)
    const label = field(input.label, 'label', 200)
    const mediaType = field(input.mediaType, 'media type', 100)
    const source = field(JSON.stringify(input.source ?? {}), 'source metadata', 6000)
    const hash = digest(bytes)
    return this.transaction(flag, () => {
      const operation = this.db.prepare('SELECT * FROM operations WHERE scope=? AND key=?').get(scope, key)
      if (!operation || operation.status !== 'uncertain') throw new Error('Artifact operation is not reserved')
      const scopeBytes = Number(this.db.prepare('SELECT coalesce(sum(size),0) AS n FROM artifacts WHERE scope=?').get(scope)?.n)
      const totalBytes = Number(this.db.prepare('SELECT coalesce(sum(size),0) AS n FROM artifacts').get()?.n)
      if (scopeBytes + bytes.byteLength > this.limits.scopeBytes || totalBytes + bytes.byteLength > this.limits.totalBytes) {
        throw new Error('Artifact storage quota exceeded; export/delete retained artifacts before collecting more')
      }
      const prior = this.db.prepare('SELECT data FROM blobs WHERE scope=? AND hash=?').get(scope, hash)
      if (prior && digest(prior.data as Uint8Array) !== hash) throw new Error('Corrupt artifact blob; refusing reuse')
      this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(scope, hash, bytes)
      const artifact: ArtifactDescriptor = { id: randomUUID(), sha256: hash, byteLength: bytes.byteLength, mediaType, label, createdAt: new Date().toISOString() }
      this.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?)').run(
        artifact.id, scope, hash, bytes.byteLength, label, mediaType, source, artifact.createdAt
      )
      this.db.prepare("UPDATE operations SET status='complete', artifact_id=? WHERE scope=? AND key=?").run(artifact.id, scope, key)
      return artifact
    })
  }

  private importFile(scope: string, input: Record<string, unknown>, flag: Int32Array): ArtifactDescriptor {
    const path = absolutePath(input.path)
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const before = fstatSync(fd)
      if (!before.isFile() || before.size > this.limits.artifactBytes) throw new Error('Import requires a regular file within the artifact byte quota')
      const bytes = readFileSync(fd)
      const after = fstatSync(fd)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Import file changed during collection')
      return this.complete(scope, { ...input, bytes, source: { kind: 'file', path, modifiedAt: before.mtime.toISOString() } }, flag)
    } finally {
      closeSync(fd)
    }
  }

  private row(scope: string, id: string): Row {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE scope=? AND id=?').get(scope, id)
    if (!row) throw new Error('Artifact unavailable in this chat/project scope')
    return row as unknown as Row
  }

  private verified(scope: string, id: string): { artifact: ArtifactDescriptor; bytes: Buffer } {
    const row = this.row(scope, id)
    const found = this.db.prepare('SELECT data FROM blobs WHERE scope=? AND hash=?').get(scope, row.hash)
    if (!found || !(found.data instanceof Uint8Array) || found.data.byteLength !== row.size || digest(found.data) !== row.hash) {
      throw new Error('Artifact corrupt or missing; no bytes returned')
    }
    return { artifact: descriptor(row), bytes: Buffer.from(found.data) }
  }

  private list(scope: string, input: Record<string, unknown>): unknown {
    const limit = integer(input.limit, 20, 1, 20)
    const after = typeof input.after === 'string' ? input.after : ''
    const rows = this.db.prepare('SELECT * FROM artifacts WHERE scope=? AND id>? ORDER BY id LIMIT ?').all(scope, after, limit + 1)
    const artifacts = rows.slice(0, limit).map((row) => descriptor(row as unknown as Row))
    return { artifacts, nextAfter: rows.length > limit ? artifacts.at(-1)!.id : null, limits: this.limits, integrity: 'not-checked; read/export verifies hashes' }
  }

  private read(scope: string, input: Record<string, unknown>): ArtifactRead {
    const { artifact, bytes } = this.verified(scope, field(input.id, 'artifact id', 64))
    const offset = integer(input.offset, 0, 0, Number.MAX_SAFE_INTEGER)
    if (input.pointer !== undefined) {
      if (artifact.mediaType !== 'application/json') throw new Error('JSON projection requires application/json')
      const selected = project(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), String(input.pointer))
      const json = JSON.stringify(selected)
      if (offset > json.length) throw new Error('Offset exceeds projected text length')
      const data = json.slice(offset, offset + 1500)
      return { artifact, encoding: 'json-text', offset, nextOffset: offset + data.length < json.length ? offset + data.length : null, total: json.length, unit: 'utf16-code-units', data }
    }
    if (offset > bytes.length) throw new Error('Offset exceeds artifact byte length')
    const end = Math.min(bytes.length, offset + 6000)
    return { artifact, encoding: 'base64', offset, nextOffset: end < bytes.length ? end : null, total: bytes.length, unit: 'bytes', data: bytes.subarray(offset, end).toString('base64') }
  }

  private exportFile(scope: string, input: Record<string, unknown>, flag: Int32Array): unknown {
    const { artifact, bytes } = this.verified(scope, field(input.id, 'artifact id', 64))
    const path = absolutePath(input.path)
    const temporary = `${path}.closedai-${randomUUID()}.tmp`
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(fd, bytes)
      fsyncSync(fd)
      if (Atomics.compareExchange(flag, 0, 0, 2) !== 0) throw new Error('Artifact export cancelled before publication')
      linkSync(temporary, path) // Atomic no-clobber publication; an existing destination is never replaced.
      return { artifact, path, exported: true }
    } finally {
      closeSync(fd)
      unlinkSync(temporary)
    }
  }

  private remove(scope: string, input: Record<string, unknown>, flag: Int32Array): unknown {
    const id = field(input.id, 'artifact id', 64)
    return this.transaction(flag, () => {
      const row = this.db.prepare('SELECT hash FROM artifacts WHERE scope=? AND id=?').get(scope, id)
      if (!row) return { deleted: false }
      this.db.prepare("UPDATE operations SET status='deleted' WHERE scope=? AND artifact_id=?").run(scope, id)
      this.db.prepare('DELETE FROM artifacts WHERE scope=? AND id=?').run(scope, id)
      this.db.prepare('DELETE FROM blobs WHERE scope=? AND hash=? AND NOT EXISTS(SELECT 1 FROM artifacts WHERE scope=? AND hash=?)').run(scope, row.hash, scope, row.hash)
      return { deleted: true, id, secureErasure: false }
    })
  }
}

function descriptor(row: Row): ArtifactDescriptor {
  return { id: row.id, sha256: row.hash, byteLength: row.size, label: row.label, mediaType: row.media_type, createdAt: row.created_at }
}

function field(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new Error(`Invalid ${name}`)
  return value
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error('Invalid range')
  return Number(value)
}

function absolutePath(value: unknown): string {
  const path = field(value, 'absolute path', 4096)
  if (!isAbsolute(path)) throw new Error('An absolute filesystem path is required')
  return path
}

function project(value: unknown, pointer: string): unknown {
  if (pointer === '') return value
  if (!pointer.startsWith('/') || /~(?![01])/u.test(pointer) || pointer.length > 2000) throw new Error('Invalid JSON pointer')
  let current = value
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~')
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) throw new Error('JSON pointer does not exist')
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
