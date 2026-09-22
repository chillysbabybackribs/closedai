import test from 'node:test'
import assert from 'node:assert/strict'
import { BrowserCoordination } from './coordination.js'
import { BrowserAssignmentIdleRelease } from './assignment-idle-release.js'

function policy(active: Set<string>) {
  const tabs = [{ id: 'user', active: true }]
  const panes = new Set(['a', 'b'])
  return new BrowserCoordination({
    tabs: () => tabs,
    create: () => 'new',
    paneExists: (pane) => panes.has(pane),
    paneRunning: (pane) => active.has(pane),
  })
}

test('releases assignments after the idle window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
  const active = new Set<string>()
  const coordination = policy(active)
  coordination.claim('user', 'a')
  const idle = new BrowserAssignmentIdleRelease(coordination, (pane) => active.has(pane), 1000)
  idle.schedule('a')
  t.mock.timers.tick(999)
  assert.equal(coordination.snapshot('a').assignmentCount, 1)
  t.mock.timers.tick(1)
  assert.equal(coordination.snapshot('a').assignmentCount, 0)
  t.mock.timers.reset()
})

test('cancel clears a pending release and detach releases immediately', () => {
  const active = new Set<string>(['a'])
  const coordination = policy(active)
  coordination.claim('user', 'a')
  const idle = new BrowserAssignmentIdleRelease(coordination, (pane) => active.has(pane), 60_000)
  idle.schedule('a')
  idle.cancel('a')
  idle.detach('a')
  assert.equal(coordination.snapshot('a').assignmentCount, 0)
})

test('idle release respects an active guard', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
  const active = new Set<string>()
  let blocked = true
  const coordination = policy(active)
  coordination.claim('user', 'a')
  const idle = new BrowserAssignmentIdleRelease(coordination, (pane) => active.has(pane), 100)
  idle.schedule('a', () => blocked)
  t.mock.timers.tick(100)
  assert.equal(coordination.snapshot('a').assignmentCount, 1)
  blocked = false
  idle.schedule('a')
  t.mock.timers.tick(100)
  assert.equal(coordination.snapshot('a').assignmentCount, 0)
  t.mock.timers.reset()
})
