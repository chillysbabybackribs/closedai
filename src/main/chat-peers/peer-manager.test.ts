import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatEvent } from '../../shared/chat.js'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import type { AppSettings } from '../../shared/types.js'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import { ChatPeerManager } from './peer-manager.js'
import { FakeSurface, MemorySettings, harness } from './peer-manager-harness.js'
import { traceLog } from '../trace/trace-log.js'

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
  const paneA = 'pane-a'
  const paneB = 'pane-b'
  const records = [paneA, paneB].map((paneId) => ({
    paneId,
    provider: 'codex' as const,
    threadId: null,
    codexThreadId: null,
    claudeSessionId: null,
    modelId: 'gpt',
    reasoningEffort: null
  }))
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: records,
    chatSelectedPaneId: paneB
  })
  const surfaces: FakeSurface[] = []
  const manager = new ChatPeerManager(settings, (_peerSettings, modelId) => {
    const surface = new FakeSurface(modelId)
    surfaces.push(surface)
    return surface
  })

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
  assert.equal(manager.snapshot().peers.length, 2)
  assert.equal(surfaces[0]!.state.activeTurnId, 'turn:first')
  await manager.send(paneB, 'second', [])
  assert.equal(surfaces[1]!.state.activeTurnId, 'turn:second')
})

test('continue creates an independent target-model pane and persists source lineage plus handoff', async () => {
  const { manager, surfaces, settings } = harness()
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
  assert.equal(manager.snapshot().peers.length, 2)
  assert.equal(surfaces[0]!.state.threadId, 'thread-a')
  assert.equal(surfaces[0]!.calls.includes('continue'), false)
  assert.equal(surfaces[1]!.state.selectedModel, 'claude:opus')
  const record = settings.get().chatPeers.find((peer) => peer.paneId === target)!
  assert.equal(record.continuation?.sourcePaneId, 'pane-a')
  assert.equal(record.continuation?.sourceThreadId, 'thread-a')
  assert.equal(record.continuation?.sourceTitle, 'Fix continuation')
  assert.match(record.continuation?.handoff ?? '', /User: Keep this context/)
})

test('continue reads a history-only source without opening it in the selected pane', async () => {
  const { manager, surfaces, settings } = harness()
  const target = await manager.continueInNewPeer(
    { paneId: null, threadId: 'saved-thread' },
    'gpt-5'
  )

  assert.deepEqual(surfaces[0]!.calls, ['start', 'read:saved-thread'])
  assert.equal(surfaces[0]!.calls.some((call) => call.startsWith('open:')), false)
  const record = settings.get().chatPeers.find((peer) => peer.paneId === target)!
  assert.equal(record.continuation?.sourceThreadId, 'saved-thread')
  assert.equal(record.continuation?.sourceTitle, 'Saved chat')
  assert.equal(record.continuation?.sourceThroughItemId, 'saved-answer')
})

test('switching away before the first send keeps a pending continuation pane', async () => {
  const { manager, surfaces } = harness()
  surfaces[0]!.state.items = [{ type: 'user', id: 'user-a', turnId: null, text: 'Keep me' }]
  const target = await manager.continueInNewPeer({ paneId: 'pane-a', threadId: null }, 'gpt')

  await manager.selectPane('pane-a')

  assert.equal(manager.snapshot().peers.some((peer) => peer.paneId === target), true)
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

test('peer awareness exposes child subagent activity without duplicating the caller', () => {
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
  const read = manager.readReadable(visible[0]!.paneId, 'pane-a')
  assert.equal(read?.items[0]?.id, 'sub-1')
})

test('closePeer stops surface and removes pane, selecting remaining pane', async () => {
  const { manager, surfaces } = harness()
  const paneB = await manager.newPeer()
  assert.equal(manager.snapshot().peers.length, 2)
  assert.equal(manager.snapshot().selectedPaneId, paneB)

  await manager.closePeer(paneB)
  assert.equal(manager.snapshot().peers.length, 1)
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.ok(surfaces[1]!.calls.includes('stop'))
})

test('switching away from an empty new chat discards it so it does not linger', async () => {
  const { manager, surfaces } = harness()
  await manager.send('pane-a', 'hello', [])
  const paneB = await manager.newPeer()
  assert.equal(manager.snapshot().peers.length, 2)
  assert.equal(manager.snapshot().selectedPaneId, paneB)

  // Switching back to pane-a without sending anything in paneB should discard empty paneB
  await manager.selectPane('pane-a')
  assert.equal(manager.snapshot().peers.length, 1)
  assert.equal(manager.snapshot().selectedPaneId, 'pane-a')
  assert.ok(surfaces[1]!.calls.includes('stop'))
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
  assert.equal(paneB, manager.snapshot().peers.find((peer) => peer.paneId === paneB)?.paneId)
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
  assert.equal(manager.snapshot().peers.some((peer) => peer.paneId === paneB), false)
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
  const { manager, surfaces, settings } = harness()
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
  const handoff = settings.get().chatPeers.find((peer) => peer.paneId === target)?.continuation?.handoff ?? ''
  assert.match(handoff, /Original answer/)
  assert.doesNotMatch(handoff, /Later question/)
  assert.equal(settings.get().chatPeers.find((peer) => peer.paneId === target)?.continuation?.sourceThroughItemId, 'a1')
  assert.equal(surfaces[0]!.state.items.length, 3)
})

test('startup retires the least recently active panes down to the open-pane cap', async () => {
  const records = manyPanes(12)
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: records,
    chatSelectedPaneId: 'pane-0'
  })
  const manager = new ChatPeerManager(settings, (_peerSettings, modelId) => new FakeSurface(modelId))

  await manager.start()

  const kept = settings.get().chatPeers.map((peer) => peer.paneId)
  assert.equal(kept.length, 8)
  // The selected pane survives even though it is the oldest; the rest keep the newest activity.
  assert.deepEqual(kept, ['pane-0', 'pane-5', 'pane-6', 'pane-7', 'pane-8', 'pane-9', 'pane-10', 'pane-11'])
  assert.deepEqual(manager.snapshot().peers.map((peer) => peer.paneId), kept)
})

test('retirement never closes a running pane or one holding an undelivered handoff', async () => {
  const records = manyPanes(10)
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
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: records,
    chatSelectedPaneId: 'pane-9'
  })
  const surfaces = new Map<string | null, FakeSurface>()
  const manager = new ChatPeerManager(settings, (peerSettings, modelId) => {
    const surface = new FakeSurface(modelId)
    surfaces.set(peerSettings.paneId, surface)
    return surface
  })
  surfaces.get('pane-0')!.state.activeTurnId = 'turn-live'

  await manager.start()

  const kept = settings.get().chatPeers.map((peer) => peer.paneId)
  assert.equal(kept.length, 8)
  assert.ok(kept.includes('pane-0'), 'a pane mid-turn stays open')
  assert.ok(kept.includes('pane-1'), 'a pending continuation stays open')
  assert.ok(kept.includes('pane-9'), 'the selected pane stays open')
  assert.equal(kept.includes('pane-2'), false)
})

test('a new chat retires the oldest pane instead of growing the workspace', async () => {
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS,
    chatPeers: manyPanes(8),
    chatSelectedPaneId: 'pane-7'
  })
  const manager = new ChatPeerManager(settings, (_peerSettings, modelId) => new FakeSurface(modelId))

  const fresh = await manager.newPeer()

  const kept = settings.get().chatPeers.map((peer) => peer.paneId)
  assert.equal(kept.length, 8)
  assert.ok(kept.includes(fresh))
  assert.equal(kept.includes('pane-0'), false)
})

function manyPanes(count: number): AppSettings['chatPeers'] {
  return Array.from({ length: count }, (_, index) => ({
    paneId: `pane-${index}`,
    provider: 'codex' as const,
    threadId: `thread-${index}`,
    codexThreadId: `thread-${index}`,
    claudeSessionId: null,
    modelId: 'gpt',
    reasoningEffort: null,
    updatedAt: index + 1
  }))
}
