import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { corruptStorePath, preserveCorruptFile, readStoreFile } from './store-recovery.ts'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function storePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'store-recovery-'))
  dirs.push(dir)
  return join(dir, 'store.json')
}

function quiet<T>(run: () => Promise<T>): Promise<T> {
  const warn = console.warn
  console.warn = () => {}
  return run().finally(() => { console.warn = warn })
}

test('a missing file reads as null and leaves nothing behind', async () => {
  const path = await storePath()
  assert.equal(await readStoreFile(path, '[test]', JSON.parse), null)
  assert.deepEqual(await readdir(join(path, '..')), [])
})

test('a readable file returns what parse makes of it', async () => {
  const path = await storePath()
  await writeFile(path, '{"n":1}')
  assert.deepEqual(await readStoreFile(path, '[test]', (text) => JSON.parse(text) as { n: number }), { n: 1 })
  assert.deepEqual(await readdir(join(path, '..')), ['store.json'])
})

test('a file parse rejects is moved aside with its bytes intact and read as null', async () => {
  const path = await storePath()
  await writeFile(path, '{ not json')
  const warnings: string[] = []
  const warn = console.warn
  console.warn = (message: string) => { warnings.push(message) }
  try {
    assert.equal(await readStoreFile(path, '[test]', JSON.parse), null)
  } finally {
    console.warn = warn
  }
  const names = await readdir(join(path, '..'))
  assert.equal(names.length, 1)
  assert.match(names[0]!, /^store\.json\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/)
  assert.equal(await readFile(join(path, '..', names[0]!), 'utf8'), '{ not json')
  await assert.rejects(stat(path), { code: 'ENOENT' }, 'the damaged file no longer sits under the store name')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0]!, /^\[test\] unreadable/)
  assert.ok(warnings[0]!.includes(names[0]!), 'the one warning names the preserved copy')
})

test('a parse that throws on shape is preserved the same way as bad JSON', async () => {
  const path = await storePath()
  await writeFile(path, '[]')
  const value = await quiet(() => readStoreFile(path, '[test]', (text) => {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed
  }))
  assert.equal(value, null)
  assert.equal((await readdir(join(path, '..'))).some((name) => name.startsWith('store.json.corrupt-')), true)
})

test('preserving a file that is not there fails quietly', async () => {
  const path = await storePath()
  assert.equal(await preserveCorruptFile(path), null)
})

test('the preserved name carries the moment without characters a filesystem refuses', () => {
  const at = new Date('2026-09-21T10:11:12.345Z')
  assert.equal(corruptStorePath('/tmp/chats.json', at), '/tmp/chats.json.corrupt-2026-09-21T10-11-12.345Z')
})
