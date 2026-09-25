import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppWindowStore } from './app-window-store.js'

test('detached window records survive a reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-windows-'))
  try {
    const file = join(dir, 'app-windows.json')
    const store = await AppWindowStore.open(file)
    store.put({ id: 'w1', cwd: '/project', tabIds: ['a', 'b'] })
    store.put({ id: 'w1', cwd: '/project', tabIds: ['a'] })
    store.put({ id: 'w2', cwd: '/other', tabIds: [] })
    store.remove('w2')
    await store.flush()
    assert.deepEqual((await AppWindowStore.open(file)).list(), [{ id: 'w1', cwd: '/project', tabIds: ['a'] }])
    assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a damaged file opens empty and malformed records are dropped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'app-windows-'))
  try {
    const file = join(dir, 'app-windows.json')
    await writeFile(file, '{not json')
    assert.deepEqual((await AppWindowStore.open(file)).list(), [])
    await writeFile(file, JSON.stringify({ version: 1, windows: [{ id: 'ok', cwd: '/p', tabIds: ['a', 3] }, { id: '', cwd: '/p' }, null] }))
    assert.deepEqual((await AppWindowStore.open(file)).list(), [{ id: 'ok', cwd: '/p', tabIds: ['a'] }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
