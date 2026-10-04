import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { createBuildFreshness, digestDirectory, newestSourceMtime, watchRendererBuilds, type BuildFreshnessDeps } from './renderer-build-reload.js'

const SETTLE_MS = 30

function harness(options: { digests: string[]; exists?: boolean }) {
  let fire: () => void = () => undefined
  const digests = [...options.digests]
  const reloads: number[] = []
  const logs: string[] = []
  const stop = watchRendererBuilds({
    rendererIndex: '/out/renderer/index.html',
    mainDir: '/out/main',
    reload: () => { reloads.push(1); return 2 },
    log: (message) => logs.push(message),
    settleMs: SETTLE_MS,
    exists: () => options.exists ?? true,
    digest: async () => digests.length > 1 ? digests.shift()! : digests[0],
    watch: (_path, onChange) => { fire = onChange; return () => { fire = () => undefined } }
  })
  return { fire: () => fire(), reloads, logs, stop }
}

test('reloads once after a burst of renderer writes settles when main is unchanged', async () => {
  const run = harness({ digests: ['launch'] })
  run.fire(); run.fire()
  await delay(SETTLE_MS / 2)
  run.fire()
  assert.equal(run.reloads.length, 0)
  await delay(SETTLE_MS * 3)
  assert.equal(run.reloads.length, 1)
  assert.deepEqual(run.logs, ['reloaded 2 app surface(s) from the new renderer build'])
  run.stop()
})

test('leaves the build for the next launch when the main bundle changed, and says so once', async () => {
  const run = harness({ digests: ['launch', 'rebuilt'] })
  run.fire()
  await delay(SETTLE_MS * 3)
  run.fire()
  await delay(SETTLE_MS * 3)
  assert.equal(run.reloads.length, 0)
  assert.equal(run.logs.length, 1)
  assert.match(run.logs[0], /restart the app/)
  run.stop()
})

test('does nothing while the build has emptied the renderer output', async () => {
  const run = harness({ digests: ['launch'], exists: false })
  run.fire()
  await delay(SETTLE_MS * 3)
  assert.equal(run.reloads.length, 0)
  run.stop()
})

test('does not reload after stop', async () => {
  const run = harness({ digests: ['launch'] })
  run.fire()
  run.stop()
  await delay(SETTLE_MS * 3)
  assert.equal(run.reloads.length, 0)
})

test('digestDirectory is stable for identical output and changes with any nested file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'renderer-build-'))
  try {
    await mkdir(join(dir, 'chunks'))
    await writeFile(join(dir, 'index.js'), 'main')
    await writeFile(join(dir, 'chunks', 'a.js'), 'one')
    const first = await digestDirectory(dir)
    await writeFile(join(dir, 'index.js'), 'main')
    assert.equal(await digestDirectory(dir), first)
    await writeFile(join(dir, 'chunks', 'a.js'), 'two')
    assert.notEqual(await digestDirectory(dir), first)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function freshness(mode: BuildFreshnessDeps['mode'], options: { digests?: Record<string, string[]>; newest?: number; built?: number | null } = {}) {
  const digests = Object.fromEntries(Object.entries(options.digests ?? {}).map(([dir, list]) => [dir, [...list]]))
  return createBuildFreshness({
    mode, mainDir: '/out/main', preloadDir: '/out/preload', rendererIndex: '/out/renderer/index.html',
    mainSources: ['/src/main'], preloadSources: ['/src/preload'], launchedAt: 1_000,
    digest: async (dir) => digests[dir].length > 1 ? digests[dir].shift()! : digests[dir][0],
    newestSourceMtime: async () => options.newest ?? 0,
    mtime: async () => options.built ?? null
  })
}

test('checkout freshness compares bundle digests with launch and the renderer build with its last load', async () => {
  const probe = freshness('checkout', { digests: { '/out/main': ['m1', 'm2'], '/out/preload': ['p1'] }, built: 5_000 })
  assert.equal(await probe.launchedMain, 'm1')
  assert.equal((await probe.check()).rendererStale, null)
  probe.rendererLoaded(4_000)
  assert.deepEqual(await probe.check(), {
    mode: 'checkout', basis: 'bundle-digest', mainStale: true, preloadStale: false, rendererStale: true,
    rendererLoadedAt: new Date(4_000).toISOString()
  })
  probe.rendererLoaded(6_000)
  assert.equal((await probe.check()).rendererStale, false)
})

test('dev freshness flags source edited after launch and leaves the hot-reloaded renderer alone', async () => {
  assert.deepEqual(await freshness('dev', { newest: 2_000 }).check(), {
    mode: 'dev', basis: 'source-mtime', mainStale: true, preloadStale: true, rendererStale: null, rendererLoadedAt: null
  })
  assert.equal((await freshness('dev', { newest: 500 }).check()).mainStale, false)
  assert.equal((await freshness('packaged').check()).mainStale, null)
})

test('newestSourceMtime ignores test files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'build-sources-'))
  try {
    await mkdir(join(dir, 'nested'))
    await writeFile(join(dir, 'nested', 'a.ts'), 'a')
    await writeFile(join(dir, 'nested', 'a.test.ts'), 'test')
    await utimes(join(dir, 'nested', 'a.ts'), 100, 100)
    await utimes(join(dir, 'nested', 'a.test.ts'), 900, 900)
    assert.equal(await newestSourceMtime([dir]), 100_000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
