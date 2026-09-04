import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatEvent } from '../../shared/chat.js'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import { PEER_READ_DEFAULT_CHARS } from '../../shared/chat-peers.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import { chatRecord, harness, harnessWith } from './peer-manager-harness.js'
import { traceLog } from '../trace/trace-log.js'

const attached = (manager: ReturnType<typeof harness>['manager']): string[] =>
  manager.snapshot().chats.filter((chat) => chat.attached).map((chat) => chat.paneId)

test('pins publish immediately, survive closing a blank pane, and reject unavailable chats', async (t) => {
  const { manager, store, surfaces } = harness()
  t.after(() => manager.stop())
  const before = store.require('pane-a').updatedAt
  const updates: ChatWorkspaceEvent[] = []
  manager.on('event', (event: ChatWorkspaceEvent) => updates.push(event))
  await manager.setChatPinned('pane-a', true)
  const pinnedAt = store.require('pane-a').pinnedAt
  assert.ok(pinnedAt)
  assert.equal(store.require('pane-a').updatedAt, before)
  assert.equal(updates.at(-1)?.type, 'chats')
  assert.equal(manager.snapshot().chats[0]?.pinnedAt, pinnedAt)
  assert.deepEqual(surfaces[0]!.calls, [], 'pinning never wakes the provider')
  await manager.setChatPinned('pane-a', true)
  assert.equal(store.require('pane-a').pinnedAt, pinnedAt)
  await manager.newPeer()
  await manager.closePeer('pane-a')
  assert.equal(store.require('pane-a').pinnedAt, pinnedAt)
  assert.equal(manager.snapshot().chats.find((chat) => chat.paneId === 'pane-a')?.attached, false)
  await manager.setChatPinned('pane-a', false)
  assert.equal(manager.snapshot().chats.find((chat) => chat.paneId === 'pane-a'), undefined)
  const foreign = store.create({ ...store.require('pane-a'), id: 'foreign', cwd: '/elsewhere' })
  await assert.rejects(manager.setChatPinned(foreign.id, true), /another project/)
  await assert.rejects(manager.setChatPinned('missing', true), /no longer available/)
  store.archive('pane-a')
  await assert.rejects(manager.setChatPinned('pane-a', true), /no longer available/)
})

test('send captures provider dispatch and first text through the pane event path', async (t) => {
  traceLog.clear()
  const { manager, surfaces } = harness()
  t.after(() => { manager.stop(); traceLog.clear() })
  const paneId = manager.snapshot().selectedPaneId
  surfaces[0]!.send = async () => {
    traceLog.record({ paneId, provider: 'codex', turnId: null }, {
      kind: 'raw', label: 'codex.out', direction: 'out', summary: 'turn/start #1', detail: {}
    })
    surfaces[0]!.emit('event', { type: 'turn', turnId: 't' } satisfies ChatEvent)
    surfaces[0]!.emit('event', { type: 'item', item: {
      type: 'assistant', id: 'a', turnId: 't', text: 'Hello', phase: 'commentary', streaming: true
    } } satisfies ChatEvent)
  }
  await manager.send(paneId, 'Hello', [])
  const timing = traceLog.snapshot().entries.find((entry) => entry.label === 'response.first_text')
  assert.equal(timing?.paneId, paneId)
  assert.equal(timing?.turnId, 't')
  assert.ok(timing!.durationMs! >= 0)
})

test('startup and workspace history only wake the selected persisted pane', async () => {
  const { manager, surfaces } = harnessWith([chatRecord('pane-a', 'gpt'), chatRecord('pane-b', 'gpt')], 'pane-b')

  await manager.start()
  await manager.listThreads()

  assert.deepEqual(surfaces[0]!.calls, [])
  assert.deepEqual(surfaces[1]!.calls, ['start', 'listThreads'])
})

test('new chat keeps a running peer alive and selects an independent surface', async () => {
  const { manager, surfaces } = harness()
  await manager.send('pane-a', 'first', [])
  const paneB = await manager.newPeer()
  assert.notEqual(paneB, 'pane-a')
  assert.equal(manager.snapshot().selectedPaneId, paneB)
  assert.equal(attached(manager).length, 2)
  assert.equal(surfaces[0]!.state.activeTurnId, 'turn:first')
  await manager.send(paneB, 'second', [])
  assert.equal(surfaces[1]!.state.activeTurnId, 'turn:second')
})

test('a new chat is announced before settings are written and inherits the model', async () => {
  const { manager, settings } = harness()
  const order: string[] = []
  const originalSet = settings.set.bind(settings)
  settings.set = async (patch) => { order.push('settings'); return originalSet(patch) }
  manager.on('event', (event: ChatWorkspaceEvent) => { if (event.type === 'workspace') order.push('workspace') })

  const paneB = await manager.newPeer()

  assert.equal(order[0], 'workspace')
  assert.ok(order.includes('settings'))
  assert.deepEqual(settings.get().chatOpenIds, ['pane-a', paneB])
  assert.equal(settings.get().chatSelectedPaneId, paneB)
  assert.equal(manager.snapshot().chats.find((chat) => chat.paneId === paneB)?.modelId, 'gpt')
})

test('continue creates an independent target-model pane and persists source lineage plus handoff', async () => {
  const { manager, surfaces, store } = harness()
  surfaces[0]!.state.threadId = 'thread-a'
  surfaces[0]!.state.threadName = 'Fix continuation'
  surfaces[0]!.state.items = [
    { type: 'user', id: 'user-a', turnId: 'turn-a', text: 'Keep this context' },
    { type: 'assistant', id: 'answer-a', turnId: 'turn-a', text: 'Context kept', phase: 'final_answer', streaming: false }
  ]

  const target = await manager.continueInNewPeer(
    { paneId: 'pane-a', threadId: 'thread-a' },
    'claude:opus'
  )

  assert.notEqual(target, 'pane-a')
  assert.equal(manager.snapshot().selectedPaneId, target)
  assert.equal(attached(manager).length, 2)
  assert.equal(surfaces[0]!.state.threadId, 'thread-a')
  assert.equal(surfaces[0]!.calls.includes('continue'), false)
  assert.equal(surfaces[1]!.state.selectedModel, 'claude:opus')
  const record = store.require(target)
  assert.equal(record.continuation?.sourcePaneId, 'pane-a')
  assert.equal(record.continuation?.sourceThreadId, 'thread-a')
  assert.equal(record.continuation?.sourceTitle, 'Fix continuation')
  assert.match(record.continuation?.handoff ?? '', /User: Keep this context/)
})

test('continue reads a history-only source without opening it in the selected pane', async () => {
  const { manager, surfaces, store } = harness()
  const target = await manager.continueInNewPeer(
    { paneId: null, threadId: 'saved-thread' },
    'gpt-5'
  )

  assert.deepEqual(surfaces[0]!.calls, ['start', 'read:saved-thread'])
  assert.equal(surfaces[0]!.calls.some((call) => call.startsWith('open:')), false)
  const record = store.require(target)
  assert.equal(record.continuation?.sourceThreadId, 'saved-thread')
  assert.equal(record.continuation?.sourceTitle, 'Saved chat')
  assert.equal(record.continuation?.sourceThroughItemId, 'saved-answer')
})

test('switching away before the first send keeps a pending continuation pane', async () => {
  const { manager, surfaces } = harness()
  surfaces[0]!.state.items = [{ type: 'user', id: 'user-a', turnId: null, text: 'Keep me' }]
  const target = await manager.continueInNewPeer({ paneId: 'pane-a', threadId: null }, 'gpt')

  await manager.selectPane('pane-a')

  assert.equal(attached(manager).includes(target), true)
  assert.equal(surfaces[1]!.calls.includes('stop'), false)
})

test('selection and interruption target one pane without stopping its peer', async () => {
  const { manager, surfaces } = harness()
  const paneB = await manager.newPeer()
  await manager.send('pane-a', 'a', [])
  await manager.send(paneB, 'b', [])
  await manager.selectPane('pane-a')
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  await manager.interrupt('pane-a')
  assert.equal(surfaces[0]!.state.activeTurnId, null)
  assert.equal(surfaces[1]!.state.activeTurnId, 'turn:b')
  assert.equal(surfaces[1]!.calls.includes('interrupt'), false)
})

test('peer awareness exposes child subagent activity without duplicating the caller', async () => {
  const { manager, surfaces } = harness()
  surfaces[0]!.state.items = [{
    type: 'tool',
    id: 'sub-1',
    turnId: 'turn',
    label: 'Subagent',
    detail: 'Review the runtime',
    status: 'inProgress'
  }]
  const visible = manager.listReadable('pane-a')
  assert.equal(visible.length, 1)
  assert.equal(visible[0]!.kind, 'subagent')
  assert.equal(visible[0]!.parentPaneId, 'pane-a')
  assert.equal(visible[0]!.running, true)
  const read = await manager.readReadable(visible[0]!.paneId, 'pane-a', { cursor: 0, limit: 30, order: 'newest', maxChars: PEER_READ_DEFAULT_CHARS })
  assert.equal(read?.items[0]?.id, 'sub-1')
})

test('closePeer detaches the pane, keeps a chat with a thread, and selects the remaining pane', async () => {
  const { manager, surfaces, store } = harness()
  const paneB = await manager.newPeer()
  assert.equal(attached(manager).length, 2)
  assert.equal(manager.snapshot().selectedPaneId, paneB)
  await manager.send(paneB, 'keep this chat', [])
  surfaces[1]!.state.activeTurnId = null
  surfaces[1]!.state.threadId = 'thread-b'
  surfaces[1]!.emit('event', { type: 'thread', threadId: 'thread-b', threadName: 'Kept' } satisfies ChatEvent)
  store.update(paneB, { codexThreadId: 'thread-b' })

  await manager.closePeer(paneB)
  assert.deepEqual(attached(manager), ['pane-a'])
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.ok(surfaces[1]!.calls.includes('stop'))
  // The chat is still in the workspace, as a detached row.
  const row = manager.snapshot().chats.find((chat) => chat.paneId === paneB)
  assert.equal(row?.attached, false)
  assert.equal(row?.threadId, 'thread-b')
})

test('closePeer discards a new chat even when provider startup created a thread', async (t) => {
  const { manager, surfaces, store } = harness()
  t.after(() => manager.stop())
  const paneB = await manager.newPeer()
  surfaces[1]!.state.threadId = 'startup-thread'
  surfaces[1]!.emit('event', { type: 'thread', threadId: 'startup-thread', threadName: 'New chat' } satisfies ChatEvent)
  store.update(paneB, { codexThreadId: 'startup-thread' })

  await manager.closePeer(paneB)

  assert.equal(store.get(paneB), undefined)
  assert.equal(manager.snapshot().chats.some((chat) => chat.paneId === paneB), false)
})

test('switching away from an empty new chat discards it so it does not linger', async () => {
  const { manager, surfaces, store } = harness()
  await manager.send('pane-a', 'hello', [])
  const paneB = await manager.newPeer()
  assert.equal(attached(manager).length, 2)
  assert.equal(manager.snapshot().selectedPaneId, paneB)

  await manager.selectPane('pane-a')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(attached(manager), ['pane-a'])
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.ok(surfaces[1]!.calls.includes('stop'))
  assert.equal(store.get(paneB), undefined)
})

test('a chat mid-open is never discarded as blank, and is once its start lands empty', async () => {
  const { manager, surfaces, store } = harnessWith([chatRecord('pane-a', 'gpt'), chatRecord('pane-b', 'gpt')], 'pane-a')
  surfaces[0]!.state.items = [{ type: 'user', id: 'u', turnId: null, text: 'real work' }]
  let release = (): void => {}
  const started = new Promise<void>((resolve) => { release = () => resolve() })
  const surfaceB = surfaces[1]!
  surfaceB.start = () => { surfaceB.calls.push('start'); return started }

  // pane-b's start is still in flight when the user clicks back to pane-a.
  await manager.selectPane('pane-b')
  await manager.selectPane('pane-a')
  assert.ok(store.get('pane-b'), 'the chat being opened survives the click-away')
  assert.ok(attached(manager).includes('pane-b'))

  release()
  await started
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(store.get('pane-b'), undefined, 'and goes once its start landed empty')
  assert.deepEqual(attached(manager), ['pane-a'])
})

test('unfocused idle panes park after the grace period and wake when selected', async () => {
  const { manager, surfaces } = harness(5)
  await manager.start()
  surfaces[0]!.state.items = [{ type: 'user', id: 'user-a', turnId: null, text: 'keep me' }]

  const paneB = await manager.newPeer()
  surfaces[1]!.state.items = [{ type: 'user', id: 'user-b', turnId: null, text: 'keep me too' }]
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.deepEqual(surfaces[0]!.calls, ['start', 'stop'])
  await manager.selectPane('pane-a')
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.deepEqual(surfaces[0]!.calls, ['start', 'stop', 'start'])
  assert.equal(attached(manager).includes(paneB), true)
})

test('the selected chat parks after the longer idle window and its next message wakes it', async () => {
  const { manager, surfaces } = harness(5)
  await manager.start()
  await manager.send('pane-a', 'first', [])
  surfaces[0]!.state.activeTurnId = null
  surfaces[0]!.emit('event', { type: 'turn', turnId: null } satisfies ChatEvent)

  await new Promise((resolve) => setTimeout(resolve, 12))
  assert.equal(surfaces[0]!.calls.includes('stop'), false, 'the selected chat outlasts the unselected grace period')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(surfaces[0]!.calls.filter((call) => call === 'stop'), ['stop'], 'then its runtime parks too')
  assert.equal(attached(manager).includes('pane-a'), true)

  await manager.send('pane-a', 'second', [])
  assert.deepEqual(surfaces[0]!.calls.slice(-2), ['start', 'send:second'])
})

test('a burst of drawer refreshes scans the thread catalog once, and archiving reopens it', async () => {
  const { manager, surfaces } = harness()
  const scans = (): number => surfaces[0]!.calls.filter((call) => call === 'listThreads').length

  await Promise.all([manager.listThreads(), manager.listThreads()])
  await manager.listThreads()
  assert.equal(scans(), 1)

  await manager.archiveThread('claude:gone')
  await manager.listThreads()
  assert.equal(scans(), 2)
})

test('listChats answers from the store and adopts provider threads in the background', async () => {
  const { manager, surfaces, store } = harness()
  surfaces[0]!.listThreads = async () => [
    { id: 'claude:old', title: 'Older work', preview: 'done', createdAt: 5, updatedAt: 9 }
  ]
  const rows = await manager.listChats()
  assert.deepEqual(rows.map((row) => row.paneId), ['pane-a'])

  await manager.listThreads()
  const adopted = store.get('claude:old')
  assert.equal(adopted?.provider, 'claude')
  assert.equal(adopted?.claudeSessionId, 'old')
  assert.equal(adopted?.title, 'Older work')
  const later = await manager.listChats()
  assert.deepEqual(later.map((row) => [row.paneId, row.attached]), [['claude:old', false], ['pane-a', true]])
})

test('history omits a detached legacy chat with only provider startup metadata', async () => {
  const empty = chatRecord('empty', 'gpt', { codexThreadId: 'startup', threadId: 'startup', title: 'New chat' })
  const { manager } = harnessWith([chatRecord('pane-a', 'gpt'), empty], 'pane-a', undefined, ['pane-a'])
  assert.deepEqual((await manager.listChats()).map((row) => row.paneId), ['pane-a'])
})

test('opening a detached chat attaches it under its own id and replaces a blank selected chat', async () => {
  const { manager, surfaces, store } = harnessWith([
    chatRecord('pane-a', 'gpt'),
    chatRecord('old', 'gpt', { codexThreadId: 'thread-old', threadId: 'thread-old', title: 'Old chat' })
  ], 'pane-a', undefined, ['pane-a'])
  // Only pane-a is attached; `old` is a history row.
  assert.deepEqual(attached(manager), ['pane-a'])

  const opened = await manager.openChat('old')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(opened, 'old')
  assert.equal(manager.snapshot().selectedPaneId, 'old')
  assert.deepEqual(attached(manager), ['old'], 'the blank chat it replaced is gone')
  assert.equal(store.get('pane-a'), undefined)
  assert.ok(surfaces.at(-1)!.calls.includes('start'))
})

test('opening a detached chat beside a real conversation keeps both', async () => {
  const { manager, surfaces } = harnessWith([
    chatRecord('pane-a', 'gpt'),
    chatRecord('old', 'gpt', { codexThreadId: 'thread-old', threadId: 'thread-old', title: 'Old chat' })
  ], 'pane-a', undefined, ['pane-a'])
  surfaces[0]!.state.items = [{ type: 'user', id: 'u', turnId: null, text: 'busy here' }]

  await manager.openChat('old')
  assert.deepEqual(attached(manager).sort(), ['old', 'pane-a'])
  assert.equal(manager.snapshot().selectedPaneId, 'old')
})

test('selecting a parked pane paints it before its runtime is back', async () => {
  const { manager, surfaces } = harness(5)
  await manager.start()
  surfaces[0]!.state.items = [{ type: 'user', id: 'user-a', turnId: null, text: 'keep me' }]
  const paneB = await manager.newPeer()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(surfaces[0]!.calls, ['start', 'stop'])

  let release = (): void => {}
  const restart = new Promise<void>((resolve) => { release = () => resolve() })
  surfaces[0]!.start = () => { surfaces[0]!.calls.push('start'); return restart }
  const events: ChatWorkspaceEvent[] = []
  manager.on('event', (event: ChatWorkspaceEvent) => events.push(event))

  await manager.selectPane('pane-a')

  // The workspace is already on pane-a while its surface is still starting.
  assert.equal(events.some((event) => event.type === 'workspace' && event.snapshot.selectedPaneId === 'pane-a'), true)
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.equal(surfaces[0]!.calls.at(-1), 'start')
  // The empty pane it left is still discarded, and its record with it.
  assert.equal(manager.snapshot().chats.some((chat) => chat.paneId === paneB), false)
  release()
  await restart
})

test('an unfocused running pane parks only after its turn finishes', async () => {
  const { manager, surfaces } = harness(5)
  await manager.start()
  await manager.send('pane-a', 'background work', [])
  await manager.newPeer()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(surfaces[0]!.calls.includes('stop'), false)

  surfaces[0]!.state.activeTurnId = null
  surfaces[0]!.emit('event', { type: 'turn', turnId: null } satisfies ChatEvent)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(surfaces[0]!.calls.includes('stop'), true)
})

test('branching at a response excludes later messages and rejects unknown endpoints', async () => {
  const { manager, surfaces, store } = harness()
  surfaces[0]!.state.items = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Original question' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'Original answer', phase: 'final_answer', streaming: false },
    { type: 'user', id: 'u2', turnId: 't2', text: 'Later question must be excluded' }
  ]
  await assert.rejects(manager.continueInNewPeer({
    paneId: 'pane-a', threadId: null, throughItemId: 'missing'
  }, null), /completed response/)
  const target = await manager.continueInNewPeer({
    paneId: 'pane-a', threadId: null, throughItemId: 'a1'
  }, null)
  const handoff = store.require(target).continuation?.handoff ?? ''
  assert.match(handoff, /Original answer/)
  assert.doesNotMatch(handoff, /Later question/)
  assert.equal(store.require(target).continuation?.sourceThroughItemId, 'a1')
  assert.equal(surfaces[0]!.state.items.length, 3)
})

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

test('stop delivers a pending chats update instead of dropping it', async () => {
  const { manager, surfaces } = harness()
  const updates: ChatWorkspaceEvent[] = []
  manager.on('event', (event: ChatWorkspaceEvent) => { if (event.type === 'chats') updates.push(event) })
  await manager.send('pane-a', 'go', [])
  surfaces[0]!.state.activeTurnId = null
  surfaces[0]!.emit('event', { type: 'turn', turnId: null } satisfies ChatEvent)
  // The second update is throttled; stopping flushes it.
  manager.stop()
  const last = updates.at(-1)!
  assert.equal(last.type === 'chats' && last.chats[0]?.running, false)
})

function manyChats(count: number): ChatRecord[] {
  return Array.from({ length: count }, (_, index) => chatRecord(`pane-${index}`, 'gpt', {
    codexThreadId: `thread-${index}`,
    threadId: `thread-${index}`,
    messageSentAt: index + 1,
    updatedAt: index + 1
  }))
}
