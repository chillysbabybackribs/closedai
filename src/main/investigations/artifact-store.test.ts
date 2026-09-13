import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
import test from 'node:test'
import type { ArtifactDescriptor, ArtifactRead, ArtifactReservation } from '../../shared/investigation-artifacts.js'
import { DEFAULT_ARTIFACT_LIMITS } from '../../shared/investigation-artifacts.js'
import { ArtifactStore } from './artifact-store.js'

const scope = { chatId: 'chat-a', workspace: '/project' }
const workerUrl = new URL('./artifact-worker.ts', import.meta.url)
const fingerprint = 'a'.repeat(64)

async function fixture(run: (store: ArtifactStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'closedai-artifacts-'))
  const store = new ArtifactStore(join(root, 'artifacts.sqlite'), { workerUrl })
  try { await run(store, root) } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
}

async function save(store: ArtifactStore, bytes: Buffer, key = 'op', label = 'fixture'): Promise<ArtifactDescriptor> {
  await store.request('reserve', scope, { key, fingerprint })
  return store.request('complete', scope, { key, bytes, label, mediaType: 'application/json', source: { kind: 'test' } })
}

test('large Unicode JSON survives worker restart, exact paged reads, projection and export', async () => {
  await fixture(async (store, root) => {
    const original = Buffer.from(JSON.stringify({ early: 'a'.repeat(50_000), tail: { 'a/b': 'é🙂'.repeat(3000) } }))
    const artifact = await save(store, original)
    await store.close()
    const restarted = new ArtifactStore(join(root, 'artifacts.sqlite'), { workerUrl })
    try {
      const chunks: Buffer[] = []
      let offset: number | null = 0
      while (offset !== null) {
        const page: ArtifactRead = await restarted.request('read', scope, { id: artifact.id, offset })
        assert.equal(page.unit, 'bytes')
        assert.equal(JSON.stringify(page).length < 16_000, true)
        chunks.push(Buffer.from(page.data, 'base64'))
        offset = page.nextOffset
      }
      assert.deepEqual(Buffer.concat(chunks), original)
      const texts: string[] = []
      offset = 0
      while (offset !== null) {
        const page: ArtifactRead = await restarted.request('read', scope, { id: artifact.id, pointer: '/tail/a~1b', offset })
        texts.push(page.data)
        offset = page.nextOffset
      }
      assert.equal(JSON.parse(texts.join('')), 'é🙂'.repeat(3000))
      const meta = await restarted.request<ArtifactRead>('read', scope, { id: artifact.id, metadata: true })
      assert.equal(JSON.parse(meta.data).source.kind, 'test')
      const destination = join(root, 'export.json')
      await restarted.request('export', scope, { id: artifact.id, path: destination })
      assert.deepEqual(await readFile(destination), original)
      await assert.rejects(restarted.request('export', scope, { id: artifact.id, path: destination }), /EEXIST/)
      assert.deepEqual(await readFile(destination), original)
    } finally { await restarted.close() }
  })
})

test('scope isolation, deduplication, deletion tombstones and committed receipts', async () => {
  await fixture(async (store) => {
    const bytes = Buffer.from('{}')
    const a = await save(store, bytes, 'a')
    const b = await save(store, bytes, 'b')
    const retry = await store.request<ArtifactReservation>('reserve', scope, { key: 'a', fingerprint })
    assert.equal(retry.state, 'complete')
    if (retry.state === 'complete') assert.equal(retry.artifact.id, a.id)
    await assert.rejects(store.request('reserve', scope, { key: 'a', fingerprint: 'b'.repeat(64) }), /different request/)
    for (const other of [{ ...scope, chatId: 'chat-b' }, { ...scope, workspace: '/elsewhere' }]) {
      await assert.rejects(store.request('read', other, { id: a.id }), /unavailable/)
      const listing = await store.request<{ artifacts: unknown[] }>('list', other, {})
      assert.deepEqual(listing.artifacts, [])
    }
    await store.request('delete', scope, { id: a.id })
    await assert.rejects(store.request('read', scope, { id: a.id }), /unavailable/)
    await assert.rejects(store.request('reserve', scope, { key: 'a', fingerprint }), /deleted/)
    const retained = await store.request<ArtifactRead>('read', scope, { id: b.id })
    assert.deepEqual(Buffer.from(retained.data, 'base64'), bytes)
  })
})

test('cancelled writes publish nothing and imports are bounded regular files', async () => {
  await fixture(async (store, root) => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(store.request('reserve', scope, { key: 'cancel', fingerprint }, controller.signal), /cancelled/)
    const path = join(root, 'selected.json')
    await writeFile(path, '{"value":42}')
    await store.request('reserve', scope, { key: 'file', fingerprint })
    const artifact = await store.request<ArtifactDescriptor>('import', scope, { key: 'file', path, label: 'selected', mediaType: 'application/json' })
    const page = await store.request<ArtifactRead>('read', scope, { id: artifact.id, pointer: '/value' })
    assert.equal(page.data, '42')
    await assert.rejects(store.request('read', scope, { id: artifact.id, pointer: '/__proto__' }), /does not exist/)
    await assert.rejects(store.request('read', scope, { id: artifact.id, offset: -1 }), /range/)
    await store.request('reserve', scope, { key: 'directory', fingerprint })
    await assert.rejects(store.request('import', scope, { key: 'directory', path: root, label: 'invalid', mediaType: 'text/plain' }), /regular file/)
  })
})

test('content corruption is detected before read/export and never silently reused', async () => {
  await fixture(async (store, root) => {
    const artifact = await save(store, Buffer.from('{}'))
    const db = new DatabaseSync(join(root, 'artifacts.sqlite'))
    try { db.prepare('UPDATE blobs SET data=?').run(Buffer.from('!!')) } finally { db.close() }
    await assert.rejects(store.request('read', scope, { id: artifact.id }), /corrupt/i)
    await assert.rejects(store.request('export', scope, { id: artifact.id, path: join(root, 'bad.json') }), /corrupt/i)
    await assert.rejects(save(store, Buffer.from('{}'), 'second'), /Corrupt/)
  })
})

test('quota refusal rolls back and uncertain reservations cannot execute again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-artifact-quota-'))
  const store = new ArtifactStore(join(root, 'db'), { workerUrl, limits: { ...DEFAULT_ARTIFACT_LIMITS, artifactBytes: 10, scopeBytes: 12 } })
  try {
    await save(store, Buffer.from('12345678'), 'first')
    await assert.rejects(save(store, Buffer.from('12345678'), 'second'), /quota/)
    await assert.rejects(store.request('reserve', scope, { key: 'second', fingerprint }), /uncertain/)
    const list = await store.request<{ artifacts: unknown[] }>('list', scope, {})
    assert.equal(list.artifacts.length, 1)
    await assert.rejects(save(store, Buffer.alloc(11), 'oversized'), /quota/)
  } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
})

test('abrupt worker termination preserves committed artifact and uncertain acquisition state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-artifact-crash-'))
  const file = join(root, 'db')
  const worker = new Worker(workerUrl, { workerData: { file } })
  let requestId = 0
  const send = (action: string, input: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
    worker.once('error', reject)
    worker.once('message', (message) => { worker.off('error', reject); message.error ? reject(new Error(message.error)) : resolve(message.result) })
    worker.postMessage({ requestId: ++requestId, action, scope, input, cancellation: new SharedArrayBuffer(4) })
  })
  try {
    await send('reserve', { key: 'committed', fingerprint })
    const artifact = await send('complete', { key: 'committed', bytes: Buffer.from('{}'), label: 'crash', mediaType: 'application/json' }) as ArtifactDescriptor
    await send('reserve', { key: 'interrupted', fingerprint })
    await worker.terminate() // No graceful close/checkpoint; WAL recovery on the next worker.
    const recovered = new ArtifactStore(file, { workerUrl })
    try {
      assert.equal((await recovered.request<ArtifactRead>('read', scope, { id: artifact.id })).data, 'e30=')
      await assert.rejects(recovered.request('reserve', scope, { key: 'interrupted', fingerprint }), /uncertain/)
      assert.equal((await recovered.request<ArtifactReservation>('reserve', scope, { key: 'committed', fingerprint })).state, 'complete')
    } finally { await recovered.close() }
  } finally { await worker.terminate(); await rm(root, { recursive: true, force: true }) }
})

test('future schema versions are refused without changing their version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-artifact-future-'))
  const file = join(root, 'db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA user_version=99')
  db.close()
  const store = new ArtifactStore(file, { workerUrl })
  try {
    await assert.rejects(store.request('list', scope, {}), /newer application/)
    const check = new DatabaseSync(file)
    try { assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 99) } finally { check.close() }
  } finally { await store.close().catch(() => undefined); await rm(root, { recursive: true, force: true }) }
})

test('two workers serialize quota admission and listing pages remain bounded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-artifact-concurrent-'))
  const file = join(root, 'db')
  const limits = { ...DEFAULT_ARTIFACT_LIMITS, scopeBytes: 10 }
  const one = new ArtifactStore(file, { workerUrl, limits })
  // Finish schema setup before opening a second process connection.
  await one.request('list', scope, {})
  const two = new ArtifactStore(file, { workerUrl, limits })
  try {
    const outcomes = await Promise.allSettled([
      save(one, Buffer.from('12345678'), 'one'), save(two, Buffer.from('12345678'), 'two')
    ])
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1)
    const rejected = outcomes.find((result) => result.status === 'rejected') as PromiseRejectedResult
    assert.match(String(rejected.reason), /quota/)
    const ids = new Set<string>()
    for (let index = 0; index < 22; index++) await save(one, Buffer.alloc(0), `empty-${index}`, '\u0001'.repeat(200))
    let after: string | null = ''
    while (after !== null) {
      const page: { artifacts: ArtifactDescriptor[]; nextAfter: string | null } = await one.request('list', scope, { after })
      assert.equal(JSON.stringify(page, null, 2).length < 16_000, true)
      for (const artifact of page.artifacts) ids.add(artifact.id)
      after = page.nextAfter
    }
    assert.equal(ids.size, 23)
  } finally { await one.close(); await two.close(); await rm(root, { recursive: true, force: true }) }
})
