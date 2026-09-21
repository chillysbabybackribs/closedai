import assert from 'node:assert/strict'
import test from 'node:test'
import { createPreviewChat } from './chat.js'
import { createPreviewBridge } from './bridge.js'
import { parseScenario } from './fixtures.js'
import { createPreviewStorage } from './storage.js'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'

test('preview preferences stay private to a document and reset on a new fixture', () => {
  const first = createPreviewStorage()
  const second = createPreviewStorage()
  first.setItem('closedai.chat-layout', 'split')
  assert.equal(second.getItem('closedai.chat-layout'), null)
  assert.equal(first.length, 1)
  assert.equal(first.key(0), 'closedai.chat-layout')
  first.removeItem('closedai.chat-layout')
  assert.equal(first.length, 0)
})

test('preview snapshots and events are isolated from consumers and other instances', async () => {
  const first = createPreviewChat('conversation', () => {})
  const second = createPreviewChat('conversation', () => {})
  try {
    const snapshot = await first.api.snapshot()
    snapshot.selected.items.length = 0
    assert.ok((await first.api.snapshot()).selected.items.length)
    const unsubscribe = first.api.onEvent((event) => {
      if (event.type === 'workspace') event.snapshot.selected.items.length = 0
    })
    await first.api.renameChat('preview-chat-1', 'Renamed sample')
    unsubscribe()
    assert.equal((await first.api.snapshot()).selected.threadName, 'Renamed sample')
    assert.ok((await first.api.snapshot()).selected.items.length)
    assert.equal((await second.api.snapshot()).selected.threadName, 'Workspace layout review')
  } finally { first.dispose(); second.dispose() }
})

test('streaming starts once, emits progress, and stops on pause or disposal', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] })
  const preview = createPreviewChat('streaming', () => {})
  const events: ChatWorkspaceEvent[] = []
  preview.api.onEvent((event) => events.push(event))
  try {
    preview.start()
    preview.start()
    assert.equal((await preview.api.snapshot()).selected.items.length, 4)
    context.mock.timers.tick(420)
    const running = (await preview.api.snapshot()).selected
    assert.ok(running.activeTurnId)
    const answer = running.items.at(-1)!
    assert.equal(answer.type, 'assistant')
    if (answer.type === 'assistant') assert.match(answer.text, /^This is a/)
    await preview.api.interrupt('preview-chat-1')
    const paused = (await preview.api.snapshot()).selected
    assert.equal(paused.activeTurnId, null)
    assert.equal(paused.pausedTurnId, running.activeTurnId)
    const count = events.length
    context.mock.timers.tick(1000)
    assert.equal(events.length, count)
    await preview.api.send('preview-chat-1', 'Try again', [])
    assert.ok((await preview.api.snapshot()).selected.activeTurnId)
    preview.dispose()
    const disposedCount = events.length
    context.mock.timers.tick(10_000)
    assert.equal(events.length, disposedCount)
  } finally { preview.dispose() }
})

test('archived preview chats can be restored before they are forgotten', async () => {
  const preview = createPreviewChat('conversation', () => {})
  try {
    const before = await preview.api.snapshot()
    const id = before.selectedPaneId
    const title = before.selected.threadName
    await preview.api.archiveChat(id)
    assert.equal((await preview.api.snapshot()).chats.some((row) => row.paneId === id), false)
    await preview.api.unarchiveChat(id)
    const restored = await preview.api.snapshot()
    assert.ok(restored.chats.some((row) => row.paneId === id && row.title === title))
    await preview.api.openChat(id)
    assert.equal((await preview.api.snapshot()).selectedPaneId, id)
  } finally { preview.dispose() }
})

test('new and closed chats preserve a valid selected pane', async () => {
  const preview = createPreviewChat('empty', () => {})
  try {
    const created = await preview.api.newPeer()
    assert.equal((await preview.api.snapshot()).selectedPaneId, created)
    await preview.api.closePeer(created)
    await preview.api.closePeer('preview-chat-2')
    await preview.api.closePeer('preview-chat-1')
    const state = await preview.api.snapshot()
    assert.equal(state.chats.length, 1)
    assert.ok(state.panes?.[state.selectedPaneId])
  } finally { preview.dispose() }
})

test('native actions report their limits and do not fabricate file or credential data', async () => {
  const notices: string[] = []
  const bridge = createPreviewBridge('empty', (message) => notices.push(message), () => {})
  try {
    await bridge.api.window.close()
    assert.match(notices.at(-1)!, /requires real Electron/)
    await assert.rejects(bridge.api.credentials.reveal('real-vault', 'secret'), /Unavailable/)
    await assert.rejects(bridge.api.localFiles.open('/etc/passwd'), /Unavailable/)
    assert.deepEqual(await bridge.api.credentials.list(), [])
    assert.equal(parseScenario(null), 'conversation')
    assert.throws(() => parseScenario('typo'), /Unknown preview scenario/)
  } finally { bridge.dispose() }
})
