import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserCoordination } from './coordination.js'
import { ToolRegistry } from '../registry.js'
import { textResult, type JsonObject } from '../tool.js'
import { batchTools } from '../batch/index.js'

function harness() {
  const tabs = [{ id: 'user', active: true }, { id: 'other', active: false }]
  const panes = new Set(['a', 'b'])
  const policy = new BrowserCoordination({
    tabs: () => tabs,
    paneExists: pane => panes.has(pane),
    create: () => { const id = `new-${tabs.length}`; tabs.push({ id, active: false }); return id }
  })
  const prepare = (pane: string, input: JsonObject, namespace = 'embedded_browser', tool = 'page') =>
    policy.prepare({ namespace, tool, arguments: input }, input, { paneId: pane })
  return { tabs, panes, policy, prepare }
}

test('two chats navigate independently and keep their targets when UI selection changes', () => {
  const { prepare, tabs } = harness()
  const a = prepare('a', { action: 'navigate', url: 'https://a.test' })
  const b = prepare('b', { action: 'navigate', url: 'https://b.test' })
  assert.notEqual(a.tab_id, b.tab_id)
  assert.equal(a.new_tab, false)
  assert.equal(tabs.find(tab => tab.active)?.id, 'user')
  for (const tab of tabs) tab.active = tab.id === b.tab_id
  assert.equal(prepare('a', { action: 'read_page' }).tab_id, a.tab_id)
  assert.equal(prepare('b', { action: 'browser_page' }, 'closedai_ui', 'capture').tab_id, b.tab_id)
  assert.equal(prepare('a', { action: 'command', method: 'DOM.getDocument' }, 'browser_cdp', 'protocol').tab_id, a.tab_id)
})

test('inspection claims a tab across calls and rejects another chat before any action', () => {
  const { prepare, policy } = harness()
  prepare('a', { action: 'read_page', tab_id: 'user' })
  for (const action of ['navigate', 'read_page', 'wait_for']) {
    assert.throws(() => prepare('b', { action, tab_id: 'user' }), /assigned to chat a/)
  }
  assert.throws(() => policy.release('user', 'b'), /assigned to chat a/)
  policy.release('user', 'a')
  assert.equal(prepare('b', { action: 'read_page', tab_id: 'user' }).tab_id, 'user')
})

test('closing a default tab never falls back to the visible page; new_tab recovers', () => {
  const { prepare, tabs } = harness()
  prepare('a', { action: 'read_page', tab_id: 'other' })
  tabs.splice(1, 1)
  assert.throws(() => prepare('a', { action: 'navigate', url: 'https://a.test' }), /closed or unavailable/)
  const recovered = prepare('a', { action: 'navigate', new_tab: true, url: 'https://a.test' })
  assert.notEqual(recovered.tab_id, 'user')
})

test('detaching a chat releases assignments; focus and turns do not', () => {
  const { prepare, panes, policy } = harness()
  prepare('a', { action: 'read_page' })
  assert.equal(policy.snapshot('a').defaultTabId, 'user')
  panes.delete('a')
  assert.equal(prepare('b', { action: 'read_page' }).tab_id, 'user')
  assert.equal(policy.snapshot('a').defaultTabId, null)
})

test('bulk close preflights every affected tab and shared session mutations refuse peer assignments', () => {
  const { prepare } = harness()
  prepare('a', { action: 'read_page', tab_id: 'user' })
  prepare('b', { action: 'read_page', tab_id: 'other' })
  for (const op of ['close_others', 'close_right']) {
    assert.throws(() => prepare('a', { action: 'browser_tab', op, tab_id: 'user' }, 'closedai_app', 'command'), /assigned to chat b/)
  }
  assert.throws(() => prepare('a', { action: 'set_cookie' }, 'embedded_browser', 'session'), /Shared browser session/)
  assert.throws(() => prepare('a', { action: 'target', operation: 'close', target_id: 'other-root' }, 'browser_cdp', 'protocol'), /Shared browser session/)
  assert.throws(() => prepare('a', { action: 'command', method: 'Target.closeTarget' }, 'browser_cdp', 'protocol'), /Shared browser session/)
  assert.throws(() => prepare('a', { action: 'click' }, 'closedai_app', 'ui'), /Shared browser session/)
  assert.equal(prepare('a', { action: 'fetch', method: 'GET' }, 'embedded_browser', 'session').method, 'GET')
})

test('registry resolves bare tool names and defaults before cross-chat locks', async () => {
  const { policy } = harness()
  const received: JsonObject[] = []
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  let started!: () => void
  const running = new Promise<void>(resolve => { started = resolve })
  const registry = new ToolRegistry([{ name: 'embedded_browser', description: 'test', tools: [{
    name: 'page', description: 'test', inputSchema: { type: 'object' },
    run: async input => { received.push(input); if (input.hold) { started(); await pending } return textResult('ok') }
  }] }])
  registry.browserCoordination = policy
  const call = (pane: string, args: JsonObject) => registry.call({ namespace: null, tool: 'page', arguments: args },
    { paneId: pane, callId: pane, threadId: null, turnId: null })
  const first = call('a', { action: 'navigate', url: 'https://a.test', hold: true })
  await running
  assert.equal((await call('b', { action: 'navigate', url: 'https://b.test' })).isError, undefined)
  const conflict = await call('b', { action: 'read_page', tab_id: received[0].tab_id })
  assert.equal(conflict.isError, true)
  assert.equal(received.length, 2)
  assert.notEqual(received[0].tab_id, received[1].tab_id)
  finish()
  await first
})

test('batch cleanup uses the actual armed tab even after the chat default changes', async () => {
  const { policy } = harness()
  const calls: JsonObject[] = []
  const registry = new ToolRegistry([{ name: 'browser_cdp', description: 'test', tools: [{
    name: 'profile', description: 'test', inputSchema: { type: 'object' },
    run: async input => { calls.push(input); return input.fail ? { ...textResult('failed'), isError: true } : textResult('ok') }
  }] }, batchTools(() => registry)])
  registry.browserCoordination = policy
  const result = await registry.call({ namespace: 'tool_batch', tool: 'run', arguments: { calls: [
    { tool: 'browser_cdp.profile', arguments: { action: 'start' } },
    { tool: 'browser_cdp.profile', arguments: { action: 'metrics', tab_id: 'other', fail: true } }
  ] } }, { paneId: 'a', callId: 'batch', threadId: null, turnId: null })
  assert.equal(result.isError, true)
  assert.deepEqual(calls.at(-1), { action: 'stop', tab_id: 'user' })
})
