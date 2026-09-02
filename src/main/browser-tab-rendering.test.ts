import test from 'node:test'
import assert from 'node:assert/strict'
import { TabRenderingPolicy } from './browser-tab-rendering.js'

const GRACE_MS = 40

function harness() {
  const log: string[] = []
  const policy = new TabRenderingPolicy(
    {
      attach: (id) => log.push(`attach:${id}`),
      detach: (id) => log.push(`detach:${id}`),
      raiseActive: () => log.push('raise')
    },
    GRACE_MS
  )
  return { policy, log }
}

test('only the active tab is attached; background tabs never enter the content tree', () => {
  const { policy, log } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')
  policy.register('tab-2')
  policy.register('tab-3')

  assert.equal(policy.isAttached('tab-1'), true)
  assert.equal(policy.isAttached('tab-2'), false)
  assert.equal(policy.isAttached('tab-3'), false)
  assert.deepEqual(log, ['attach:tab-1'])
})

test('activating a tab attaches it and detaches the one it replaced', () => {
  const { policy, log } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')
  policy.register('tab-2')
  log.length = 0

  policy.setActive('tab-2')

  assert.equal(policy.isAttached('tab-1'), false)
  assert.equal(policy.isAttached('tab-2'), true)
  assert.deepEqual(log, ['detach:tab-1', 'attach:tab-2'])
})

test('a pin attaches a background tab and restores the active tab z-order', () => {
  const { policy, log } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')
  policy.register('tab-2')
  log.length = 0

  const release = policy.pin('tab-2')

  assert.equal(policy.isAttached('tab-2'), true)
  // The active tab must go back on top: Electron raises a re-added view above its siblings.
  assert.deepEqual(log, ['attach:tab-2', 'raise'])
  release()
})

test('pins nest, and the tab stays attached until the last one releases', () => {
  const { policy } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')
  policy.register('tab-2')

  const first = policy.pin('tab-2')
  const second = policy.pin('tab-2')
  assert.equal(policy.describe('tab-2').pins, 2)

  first()
  assert.equal(policy.isAttached('tab-2'), true, 'still pinned by the second holder')
  assert.equal(policy.describe('tab-2').inGrace, false)

  second()
  // Detaching is deferred by the grace window so a burst of calls attaches once.
  assert.equal(policy.isAttached('tab-2'), true)
  assert.equal(policy.describe('tab-2').inGrace, true)
})

test('releasing a pin twice does not double-count', () => {
  const { policy } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')
  policy.register('tab-2')

  const outer = policy.pin('tab-2')
  const inner = policy.pin('tab-2')
  inner()
  inner()

  assert.equal(policy.describe('tab-2').pins, 1, 'the outer pin survives a repeated release')
  outer()
})

test('the grace window expires and the background tab detaches', async () => {
  const { policy, log } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')
  policy.register('tab-2')

  policy.pin('tab-2')()
  assert.equal(policy.isAttached('tab-2'), true)

  // Drive the real timer rather than faking it, at the harness's compressed grace window.
  await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 3))

  assert.equal(policy.isAttached('tab-2'), false)
  assert.ok(log.includes('detach:tab-2'))
})

test('an unpinned ACTIVE tab keeps rendering without holding a grace timer', () => {
  const { policy } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')

  policy.pin('tab-1')()

  assert.equal(policy.isAttached('tab-1'), true)
  assert.equal(policy.describe('tab-1').inGrace, false)
})

test('hiding the pane detaches even the active tab, and showing it re-attaches', () => {
  const { policy, log } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')
  log.length = 0

  policy.setPaneVisible(false)
  assert.equal(policy.isAttached('tab-1'), false)

  policy.setPaneVisible(true)
  assert.equal(policy.isAttached('tab-1'), true)
  assert.deepEqual(log, ['detach:tab-1', 'attach:tab-1'])
})

test('a tab pinned for work still renders while the pane is hidden', () => {
  const { policy } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')
  policy.register('tab-2')

  policy.pin('tab-2')
  policy.setPaneVisible(false)

  assert.equal(policy.isAttached('tab-1'), false, 'the on-screen tab has no screen to be on')
  assert.equal(policy.isAttached('tab-2'), true, 'in-flight work still needs frames')
})

test('activating a tab while the pane is hidden does not attach it', () => {
  const { policy, log } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')
  policy.register('tab-2')
  policy.setPaneVisible(false)
  log.length = 0

  policy.setActive('tab-2')

  assert.equal(policy.isAttached('tab-2'), false)
  assert.deepEqual(log, [])
})

test('worker tabs are exempt and stay attached regardless of activation', () => {
  const { policy } = harness()
  policy.register('worker-1', { exempt: true })

  assert.equal(policy.isAttached('worker-1'), true)
  assert.equal(policy.describe('worker-1').exempt, true)

  policy.setPaneVisible(false)
  assert.equal(policy.isAttached('worker-1'), true, 'a hidden worker window has no pane to hide')
})

test('pinning an unknown tab is a no-op with a safe release', () => {
  const { policy, log } = harness()
  const release = policy.pin('tab-missing')
  release()
  assert.deepEqual(log, [])
})

test('unregister forgets a closed tab without detaching its disposed view', () => {
  const { policy, log } = harness()
  policy.register('tab-1')
  policy.setActive('tab-1')
  const release = policy.pin('tab-1')
  log.length = 0

  policy.unregister('tab-1')

  assert.deepEqual(log, [], 'the caller destroys the view itself')
  assert.equal(policy.isAttached('tab-1'), false)
  // A late release from an in-flight call must not resurrect the closed tab or
  // create a grace timer whose only subject has already been destroyed.
  release()
  assert.deepEqual(log, [])
  assert.equal(policy.describe('tab-1').inGrace, false)
})
