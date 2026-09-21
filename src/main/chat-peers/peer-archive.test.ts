import assert from 'node:assert/strict'
import test from 'node:test'
import { chatRecord, harnessWith } from './peer-manager-harness.js'
import { PendingArchives } from './peer-archive.js'

test('pending archives commit unless cancelled, and stop drops them', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const committed: string[] = []
  const pending = new PendingArchives((id) => { committed.push(id) }, 8000)
  pending.schedule('a')
  pending.schedule('b')
  assert.equal(pending.cancel('a'), true)
  assert.equal(pending.has('a'), false)
  t.mock.timers.tick(8000)
  assert.deepEqual(committed, ['b'])
  pending.schedule('c')
  pending.stop()
  t.mock.timers.tick(8000)
  assert.deepEqual(committed, ['b'])
})

test('trash hides the chat immediately and undo restores it before the provider archive', async (t) => {
  const { manager, store, surfaces } = harnessWith([
    chatRecord('pane-a', 'gpt', {
      title: 'Work', threadId: 't1', codexThreadId: 't1', preview: 'Saved', messageSentAt: 2
    })
  ], 'pane-a')
  t.after(() => manager.stop())
  await manager.archiveChat('pane-a')
  assert.equal(store.require('pane-a').archived, true)
  assert.equal(manager.snapshot().chats.some((row) => row.paneId === 'pane-a'), false)
  assert.equal(surfaces.some((surface) => surface.calls.some((call) => call.startsWith('archive:'))), false)
  await manager.unarchiveChat('pane-a')
  assert.equal(store.require('pane-a').archived, false)
  assert.ok(manager.snapshot().chats.some((row) => row.paneId === 'pane-a'))
  await manager.flushPendingArchives()
  assert.equal(surfaces.some((surface) => surface.calls.some((call) => call.startsWith('archive:'))), false)
})

test('the undo window expiry archives the provider thread and then restore is refused', async (t) => {
  const { manager, store, surfaces } = harnessWith([
    chatRecord('pane-a', 'gpt', {
      title: 'Work', threadId: 't1', codexThreadId: 't1', preview: 'Saved', messageSentAt: 2
    })
  ], 'pane-a')
  t.after(() => manager.stop())
  await manager.archiveChat('pane-a')
  await manager.flushPendingArchives()
  assert.ok(surfaces.some((surface) => surface.calls.includes('archive:t1')))
  assert.equal(store.require('pane-a').archived, true)
  await assert.rejects(manager.unarchiveChat('pane-a'), /no longer be restored/)
})

test('a tool archive commits the provider thread immediately', async (t) => {
  const { manager, store, surfaces } = harnessWith([
    chatRecord('pane-a', 'gpt', {
      title: 'Tool', threadId: 't-tool', codexThreadId: 't-tool', preview: 'Saved', messageSentAt: 2
    })
  ], 'pane-a')
  t.after(() => manager.stop())
  await manager.archiveThread('t-tool')
  assert.ok(surfaces.some((surface) => surface.calls.includes('archive:t-tool')))
  assert.equal(store.require('pane-a').archived, true)
})
