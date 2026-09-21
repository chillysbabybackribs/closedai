import test from 'node:test'
import assert from 'node:assert/strict'
import { TabCadencePolicy, webContentsCadence } from './browser-tab-cadence.js'

const GRACE_MS = 40

function harness() {
  const log: string[] = []
  const policy = new TabCadencePolicy({ setThrottled: (id, throttled) => log.push(`${id}:${throttled}`) }, GRACE_MS)
  return { policy, log }
}

const settle = (ms = GRACE_MS + 20) => new Promise((resolve) => setTimeout(resolve, ms))

test('a touched tab runs unthrottled and returns to Chromium’s default after the grace window', async () => {
  const { policy, log } = harness()

  policy.touch('tab-1')

  assert.deepEqual(log, ['tab-1:false'])
  assert.deepEqual(policy.describe('tab-1'), { unthrottled: true, holds: 0, inGrace: true })
  await settle()
  assert.deepEqual(log, ['tab-1:false', 'tab-1:true'])
  assert.deepEqual(policy.describe('tab-1'), { unthrottled: false, holds: 0, inGrace: false })
})

test('a burst of calls is one exemption and the grace runs from the last of them', async () => {
  const { policy, log } = harness()
  policy.touch('tab-1')
  await settle(GRACE_MS / 2)
  policy.touch('tab-1')
  await settle(GRACE_MS / 2)

  // The second touch pushed the restore out; a single toggle covered both calls.
  assert.deepEqual(log, ['tab-1:false'])
  await settle()
  assert.deepEqual(log, ['tab-1:false', 'tab-1:true'])
})

test('a hold outlives the grace window and only its release starts one', async () => {
  const { policy, log } = harness()

  const release = policy.hold('tab-1')
  await settle()

  assert.deepEqual(log, ['tab-1:false'], 'a held tab is never restored mid-operation')
  assert.deepEqual(policy.describe('tab-1'), { unthrottled: true, holds: 1, inGrace: false })
  release()
  release()
  assert.equal(policy.describe('tab-1').inGrace, true)
  await settle()
  assert.deepEqual(log, ['tab-1:false', 'tab-1:true'])
})

test('nested holds restore once, when the last one releases', async () => {
  const { policy, log } = harness()
  const outer = policy.hold('tab-1')
  const inner = policy.hold('tab-1')

  inner()
  await settle()
  assert.deepEqual(log, ['tab-1:false'])

  outer()
  await settle()
  assert.deepEqual(log, ['tab-1:false', 'tab-1:true'])
})

test('a touch during a hold does not schedule a restore behind the hold', async () => {
  const { policy, log } = harness()
  const release = policy.hold('tab-1')

  policy.touch('tab-1')
  await settle()

  assert.deepEqual(log, ['tab-1:false'])
  assert.deepEqual(policy.describe('tab-1'), { unthrottled: true, holds: 1, inGrace: false })
  release()
  await settle()
  assert.deepEqual(log, ['tab-1:false', 'tab-1:true'])
})

test('a closed tab is forgotten without touching its destroyed WebContents', async () => {
  const { policy, log } = harness()
  policy.hold('tab-1')
  policy.touch('tab-2')

  policy.forget('tab-1')
  policy.forget('tab-2')
  await settle()

  assert.deepEqual(log, ['tab-1:false', 'tab-2:false'])
  assert.deepEqual(policy.describe('tab-1'), { unthrottled: false, holds: 0, inGrace: false })
})

test('dispose drops pending restores', async () => {
  const { policy, log } = harness()
  policy.touch('tab-1')

  policy.dispose()
  await settle()

  assert.deepEqual(log, ['tab-1:false'])
})

test('the live adapter leaves an unknown or destroyed tab alone', () => {
  const allowed: boolean[] = []
  const contents = {
    destroyed: false,
    isDestroyed: () => contents.destroyed,
    setBackgroundThrottling: (allow: boolean) => { allowed.push(allow) }
  }
  const adapter = webContentsCadence((tabId) => (tabId === 'tab-1' ? contents : null))

  adapter.setThrottled('tab-1', false)
  adapter.setThrottled('tab-9', true)
  contents.destroyed = true
  adapter.setThrottled('tab-1', true)

  assert.deepEqual(allowed, [false], 'only the live tab is told, and `throttled` is Electron’s `allowed`')
})

test('tabs are exempted independently', async () => {
  const { policy, log } = harness()
  const release = policy.hold('tab-1')
  policy.touch('tab-2')
  await settle()

  assert.deepEqual(log, ['tab-1:false', 'tab-2:false', 'tab-2:true'])
  release()
})
