import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DEFAULT_SECURITY_SETTINGS } from '../shared/security.ts'
import { SecuritySettingsStore } from './security-settings-store.ts'

async function storeWith(contents: string | null): Promise<{ store: SecuritySettingsStore; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-security-'))
  const file = join(dir, 'security-settings.json')
  if (contents !== null) await writeFile(file, contents)
  return { store: await SecuritySettingsStore.open(file), file }
}

test('a missing file yields the historical defaults: nothing asks, nothing blocks', async () => {
  const { store } = await storeWith(null)
  assert.deepEqual(store.get(), DEFAULT_SECURITY_SETTINGS)
  assert.deepEqual(store.get(), {
    credentialsRequireApproval: false, secretsRequireKeychain: false, webPermissions: 'allow', importBrowserCookies: true
  })
})

test('set merges a patch, persists it, notifies listeners, and survives a reopen', async () => {
  const { store, file } = await storeWith(null)
  const seen: string[] = []
  const stop = store.onChange((settings) => seen.push(settings.webPermissions))
  const next = await store.set({ webPermissions: 'ask' })
  assert.equal(next.webPermissions, 'ask')
  assert.equal(next.credentialsRequireApproval, false)
  assert.deepEqual(seen, ['ask'])
  stop()
  await store.set({ credentialsRequireApproval: true })
  assert.deepEqual(seen, ['ask'], 'an unsubscribed listener is not called')
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ...DEFAULT_SECURITY_SETTINGS, webPermissions: 'ask', credentialsRequireApproval: true })
  const reopened = await SecuritySettingsStore.open(file)
  assert.equal(reopened.get().webPermissions, 'ask')
})

test('unknown values in a patch fall back to defaults rather than persisting garbage', async () => {
  const { store } = await storeWith('{"webPermissions":"maybe","importBrowserCookies":"no"}')
  assert.equal(store.get().webPermissions, 'allow')
  assert.equal(store.get().importBrowserCookies, true)
  const next = await store.set({ webPermissions: 'sometimes' as never })
  assert.equal(next.webPermissions, 'allow')
})

test('an unreadable file is moved aside, not overwritten, and defaults are used', async () => {
  const { store, file } = await storeWith('{"webPermissions": "block"')
  const original = console.warn
  console.warn = () => {}
  try {
    assert.deepEqual(store.get(), DEFAULT_SECURITY_SETTINGS)
    await store.set({ secretsRequireKeychain: true })
  } finally {
    console.warn = original
  }
  const entries = (await readdir(join(file, '..'))).sort()
  assert.equal(entries.length, 2)
  assert.equal(entries[0], 'security-settings.json')
  assert.match(entries[1]!, /^security-settings\.json\.corrupt-/)
  assert.equal(await readFile(join(file, '..', entries[1]!), 'utf8'), '{"webPermissions": "block"')
})
