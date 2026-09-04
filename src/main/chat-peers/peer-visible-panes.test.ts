import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.ts'
import { rendererChatForwarder } from './peer-events.ts'
import { chatRecord, harness, harnessWith, HARNESS_CWD } from './peer-manager-harness.ts'

test('visible panes receive independent live events; hiding retains the running chat', async () => {
  const { manager, surfaces } = harnessWith([chatRecord('pane-a', null), chatRecord('pane-b', null)], 'pane-a')
  const delivered: ChatWorkspaceEvent[] = []
  manager.on('event', rendererChatForwarder('pane-a', (event) => delivered.push(event)))
  await manager.setVisiblePanes(HARNESS_CWD, ['pane-a', 'pane-b'])
  assert.deepEqual(Object.keys(manager.snapshot({ limit: 200 }).panes!), ['pane-a', 'pane-b'])
  await manager.selectPane('pane-b')
  assert.ok(manager.snapshot().chats.some((row) => row.paneId === 'pane-a'))
  delivered.length = 0
  surfaces[0]!.emit('event', { type: 'turn', turnId: 'turn-a' })
  surfaces[1]!.emit('event', { type: 'turn', turnId: 'turn-b' })
  assert.deepEqual(delivered.filter((event) => event.type === 'pane').map((event) => event.paneId), ['pane-a', 'pane-b'])
  const stops = surfaces[0]!.calls.filter((call) => call === 'stop').length
  await manager.setVisiblePanes(HARNESS_CWD, ['pane-b'])
  delivered.length = 0
  surfaces[0]!.emit('event', { type: 'itemDelta', itemId: 'a', field: 'text', delta: 'hidden' })
  assert.equal(delivered.filter((event) => event.type === 'pane').length, 0)
  assert.equal(surfaces[0]!.calls.filter((call) => call === 'stop').length, stops)
  manager.stop()
})

test('visibility rejects missing ids and ignores an old project update', async () => {
  const { manager } = harness()
  await assert.rejects(manager.setVisiblePanes(HARNESS_CWD, ['missing']), /no longer available/)
  await manager.setVisiblePanes('/previous-project', ['missing'])
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  manager.stop()
})

test('inactive empty tabs survive switching without receiving display subscriptions', async () => {
  const { manager, store } = harnessWith([chatRecord('pane-a', null), chatRecord('pane-b', null)], 'pane-a')
  try {
    await manager.setVisiblePanes(HARNESS_CWD, ['pane-a'], ['pane-a', 'pane-b'])
    await manager.selectPane('pane-b')
    await manager.setVisiblePanes(HARNESS_CWD, ['pane-b'], ['pane-a', 'pane-b'])
    assert.deepEqual(Object.keys(manager.snapshot({ limit: 200 }).panes!), ['pane-b'])
    await manager.selectPane('pane-a')
    assert.ok(store.get('pane-b'), 'switching away must not discard an empty tab')
    await manager.setVisiblePanes(HARNESS_CWD, ['pane-a'], ['pane-a'])
    await manager.selectPane('pane-b')
    await manager.selectPane('pane-a')
    assert.equal(store.get('pane-b'), undefined, 'once removed from tabs, normal blank cleanup resumes')
    await assert.rejects(manager.setVisiblePanes(HARNESS_CWD, ['pane-a'], ['missing']), /tab is no longer available/)
  } finally { manager.stop() }
})
