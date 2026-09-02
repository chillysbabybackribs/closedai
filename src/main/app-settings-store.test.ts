import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppSettingsStore, DEFAULT_APP_SETTINGS } from './app-settings-store.ts'

async function storeWith(contents: string | null): Promise<{ store: AppSettingsStore; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-settings-'))
  const file = join(dir, 'app-settings.json')
  if (contents !== null) await writeFile(file, contents)
  return { store: await AppSettingsStore.open(file), file }
}

test('a missing file yields the defaults, including the compaction threshold', async () => {
  const { store } = await storeWith(null)
  assert.deepEqual(store.get(), DEFAULT_APP_SETTINGS)
  assert.equal(store.get().chatCompactAtPercent, 60)
})

test('the compaction threshold is clamped and bad values fall back', async () => {
  assert.equal((await storeWith('{"chatCompactAtPercent": 140}')).store.get().chatCompactAtPercent, 95)
  assert.equal((await storeWith('{"chatCompactAtPercent": -4}')).store.get().chatCompactAtPercent, 0)
  assert.equal((await storeWith('{"chatCompactAtPercent": "soon"}')).store.get().chatCompactAtPercent, 60)
  const { store, file } = await storeWith('{}')
  const updated = await store.set({ chatCompactAtPercent: 72.4 })
  assert.equal(updated.chatCompactAtPercent, 72)
  assert.match(await readFile(file, 'utf8'), /"chatCompactAtPercent": 72/)
})
