import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatRecord } from '../../shared/chat-store.js'
import { chatRecord, harness, harnessWith } from './peer-manager-harness.js'

const attached = (manager: ReturnType<typeof harness>['manager']): string[] =>
  manager.snapshot().chats.filter((chat) => chat.attached).map((chat) => chat.paneId)

test('startup detaches the least recently active panes down to the cap but keeps every record', async () => {
  const records = manyChats(12)
  const { manager, settings, store } = harnessWith(records, 'pane-0')

  await manager.start()

  const kept = attached(manager)
  assert.equal(kept.length, 8)
  // The selected pane survives even though it is the oldest; the rest keep the newest activity.
  assert.deepEqual(kept.sort(), ['pane-0', 'pane-10', 'pane-11', 'pane-5', 'pane-6', 'pane-7', 'pane-8', 'pane-9'])
  assert.deepEqual([...settings.get().chatOpenIds].sort(), kept)
  assert.equal(store.list('/workspace').length, 12, 'detached chats stay in the store')
  assert.equal(manager.snapshot().chats.length, 12)
})

test('detaching never closes a running pane or one holding an undelivered handoff', async () => {
  const records = manyChats(10)
  records[1] = {
    ...records[1]!,
    continuation: {
      sourcePaneId: null,
      sourceThreadId: 'source',
      sourceProvider: 'codex',
      sourceTitle: 'Source chat',
      handoff: 'digest',
      createdAt: 1
    }
  }
  const { manager, surfaces } = harnessWith(records, 'pane-9')
  surfaces[0]!.state.activeTurnId = 'turn-live'

  await manager.start()

  const kept = attached(manager)
  assert.equal(kept.length, 8)
  assert.ok(kept.includes('pane-0'), 'a pane mid-turn stays open')
  assert.ok(kept.includes('pane-1'), 'a pending continuation stays open')
  assert.ok(kept.includes('pane-9'), 'the selected pane stays open')
  assert.equal(kept.includes('pane-2'), false)
})

test('a new chat detaches the oldest pane instead of growing the workspace', async () => {
  const { manager, surfaces } = harnessWith(manyChats(8), 'pane-7')

  const fresh = await manager.newPeer()

  const kept = attached(manager)
  assert.equal(kept.length, 8)
  assert.ok(kept.includes(fresh))
  assert.equal(kept.includes('pane-0'), false)
  assert.ok(surfaces[0]!.calls.includes('stop'), 'the detached chat has no runtime left')
})

test('consecutive new chats park the runtimes of older idle chats instead of stacking them', async () => {
  const { manager, surfaces } = harness()
  await manager.send('pane-a', 'first', [])
  surfaces[0]!.emit('event', { type: 'turn', turnId: null })
  surfaces[0]!.state.activeTurnId = null

  // Each new chat wakes in the background; let it, as a user typing into it would.
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
  const second = await manager.newPeer()
  await settle()
  const third = await manager.newPeer()
  await settle()
  assert.equal(surfaces[0]!.calls.includes('stop'), false, 'two idle chats stay awake for a quick return')

  await manager.newPeer()
  assert.ok(surfaces[0]!.calls.includes('stop'), 'the oldest idle chat parks when a third is left behind')
  assert.equal(surfaces[1]!.calls.includes('stop'), false)
  assert.equal(surfaces[2]!.calls.includes('stop'), false)
  assert.deepEqual(attached(manager).slice(0, 3).length, 3, 'parking keeps the panes attached')
  assert.ok(attached(manager).includes('pane-a') && attached(manager).includes(second) && attached(manager).includes(third))
})

test('a running chat is never parked for the awake budget', async () => {
  const { manager, surfaces } = harness()
  await manager.send('pane-a', 'first', [])
  for (let i = 0; i < 3; i += 1) {
    await manager.newPeer()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.equal(surfaces[0]!.calls.includes('stop'), false)
  assert.equal(surfaces[0]!.state.activeTurnId, 'turn:first')
})

function manyChats(count: number): ChatRecord[] {
  return Array.from({ length: count }, (_, index) => chatRecord(`pane-${index}`, 'gpt', {
    codexThreadId: `thread-${index}`,
    threadId: `thread-${index}`,
    messageSentAt: index + 1,
    updatedAt: index + 1
  }))
}
