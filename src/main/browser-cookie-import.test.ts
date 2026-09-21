import assert from 'node:assert/strict'
import test from 'node:test'
import type { Session } from 'electron'

import { importBrowserCookiesNow, importDefaultBrowserCookies, type CookieImportDeps } from './browser-cookie-import.ts'
import type { BrowserSource } from './import-cookies.ts'

const chrome: BrowserSource = { id: 'chrome', name: 'Google Chrome', keyringApp: 'chrome', cookiesPath: '/dev/null' }

function harness(options: { latched?: boolean; enabled?: boolean; sources?: BrowserSource[]; existing?: number; fail?: boolean } = {}) {
  const calls: string[] = []
  let latched = options.latched ?? false
  const target = {
    cookies: {
      get: async () => { calls.push('get'); return new Array(options.existing ?? 0).fill({}) },
      flushStore: async () => { calls.push('flush') }
    }
  } as unknown as Session
  const deps: CookieImportDeps = {
    latch: { get: () => ({ browserCookiesImported: latched }), set: async (patch) => { latched = patch.browserCookiesImported; calls.push('latch') } },
    enabled: () => options.enabled ?? true,
    target: () => target,
    sources: () => options.sources ?? [chrome],
    run: async (source) => {
      calls.push(`run:${source.id}`)
      if (options.fail) throw new Error('keyring locked')
      return { source: source.name, imported: 3, failed: 1, skipped: 2 }
    }
  }
  return { deps, calls, latched: () => latched }
}

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const { log, warn } = console
  console.log = () => {}
  console.warn = () => {}
  try {
    return await run()
  } finally {
    console.log = log
    console.warn = warn
  }
}

test('launch: first run imports from the first source, flushes, and sets the latch', async () => {
  const { deps, calls, latched } = harness()
  await quietly(() => importDefaultBrowserCookies(deps))
  assert.deepEqual(calls, ['run:chrome', 'flush', 'latch'])
  assert.equal(latched(), true)
})

test('launch: a set latch with a populated session skips; an empty session re-imports', async () => {
  const populated = harness({ latched: true, existing: 4 })
  await quietly(() => importDefaultBrowserCookies(populated.deps))
  assert.deepEqual(populated.calls, ['get'])
  const empty = harness({ latched: true, existing: 0 })
  await quietly(() => importDefaultBrowserCookies(empty.deps))
  assert.deepEqual(empty.calls, ['get', 'run:chrome', 'flush', 'latch'])
})

test('launch: a failed import does not latch, and no source is a quiet skip', async () => {
  const failing = harness({ fail: true })
  await quietly(() => importDefaultBrowserCookies(failing.deps))
  assert.deepEqual(failing.calls, ['run:chrome'])
  assert.equal(failing.latched(), false)
  const none = harness({ sources: [] })
  await quietly(() => importDefaultBrowserCookies(none.deps))
  assert.deepEqual(none.calls, [])
})

test('launch: the Settings → Security switch off skips everything, latch included', async () => {
  const { deps, calls, latched } = harness({ enabled: false })
  await quietly(() => importDefaultBrowserCookies(deps))
  assert.deepEqual(calls, [])
  assert.equal(latched(), false)
})

test('on demand: runs regardless of latch and switch, returns the counts, and surfaces a failure', async () => {
  const { deps, calls } = harness({ latched: true, enabled: false, existing: 9 })
  assert.deepEqual(await importBrowserCookiesNow(deps), { source: 'Google Chrome', imported: 3, failed: 1, skipped: 2 })
  assert.deepEqual(calls, ['run:chrome', 'flush', 'latch'])
  assert.deepEqual(await importBrowserCookiesNow(harness({ sources: [] }).deps), { source: null, imported: 0, failed: 0, skipped: 0 })
  await assert.rejects(importBrowserCookiesNow(harness({ fail: true }).deps), /keyring locked/)
})
