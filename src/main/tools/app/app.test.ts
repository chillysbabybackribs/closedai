import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { appTools } from './index.js'
import type { AppCommandHost, AppUiHost } from './host.js'

function harness(overrides: { ui?: Partial<AppUiHost>; app?: Partial<AppCommandHost> } = {}) {
  const calls: unknown[] = []
  const ui: AppUiHost = {
    controls: async (filter) => {
      calls.push(['controls', filter])
      return { surfaces: ['shell', 'chat'], controls: [], total: 0, omitted: 0 }
    },
    uiState: async () => {
      calls.push(['uiState'])
      return {
        drawerOpen: true, historyOpen: false, downloadsOpen: false, dialogs: [], menus: [],
        composer: { enabled: true, running: false, canSend: false, draftLength: 0 }, focused: null,
        viewport: { width: 1920, height: 1048 }
      }
    },
    click: async (target) => { calls.push(['click', target]); return { point: { x: 10, y: 20 } } },
    typeText: async (target) => { calls.push(['typeText', target]); return { value: target.text } },
    pressKey: async (key, modifiers) => { calls.push(['pressKey', key, modifiers]); return { key, modifiers } },
    scroll: async (target) => { calls.push(['scroll', target]); return { scrolled: target.control ? 'into_view' : 'wheel' } },
    waitFor: async (options, signal) => {
      calls.push(['waitFor', options, signal.aborted])
      return { ...options, reached: true, elapsedMs: 75, targetVisible: 1, targetEnabled: 1, textMatched: null }
    },
    ...overrides.ui
  }
  const app: AppCommandHost = {
    state: (sections, paneId, callerPaneId) => {
      calls.push(['state', sections, paneId, callerPaneId])
      return Object.fromEntries(sections.map((section) => [section, { section }]))
    },
    selectedPaneId: () => 'pane-selected',
    newChat: async () => { calls.push(['newChat']); return { paneId: 'pane-new' } },
    sendMessage: async (request) => {
      calls.push(['sendMessage', { ...request, signal: request.signal.aborted }])
      return { paneId: request.paneId, turnStarted: true, turnCompleted: true, elapsedMs: 1200 }
    },
    stopAgent: async (paneId) => { calls.push(['stopAgent', paneId]) },
    openChat: async (request) => { calls.push(['openChat', request]); return { paneId: request.paneId ?? 'pane-selected', threadId: 'thread-1' } },
    closeChat: async (paneId) => { calls.push(['closeChat', paneId]) },
    selectModel: async (paneId, modelId, effort) => { calls.push(['selectModel', paneId, modelId, effort]) },
    browserTab: async (request) => { calls.push(['browserTab', request]); return { tabCount: 1 } },
    ...overrides.app
  }
  const registry = new ToolRegistry([appTools(() => app, () => ui)])
  const call = (tool: string, arguments_: Record<string, unknown>, paneId: string | null = 'pane-caller') => registry.call(
    { namespace: 'closedai_app', tool, arguments: arguments_ },
    { threadId: null, turnId: null, callId: 'app-call', paneId }
  )
  return { calls, call, registry }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('namespace advertises state, deterministic commands, and control-level ui actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['closedai_app.state', 'closedai_app.command', 'closedai_app.ui'])
  const [state, command, ui] = registry.namespaces[0]!.tools
  assert.equal(state!.actions, undefined)
  assert.deepEqual(command!.actions?.map((action) => action.name), [
    'new_chat', 'send_message', 'stop_agent', 'open_chat', 'close_chat', 'select_model', 'browser_tab'
  ])
  assert.deepEqual(ui!.actions?.map((action) => action.name), [
    'controls', 'click', 'type', 'press_key', 'scroll', 'wait_for'
  ])
  assert.match(ui!.description, /families: titlebar, window, drawer, chat, composer, browser, downloads, dialog, tools, trace, settings/)
})

test('state returns every section by default and only the requested ones otherwise', async () => {
  const { calls, call } = harness()
  const full = await call('state', {})
  assert.match(textOf(full), /"drawerOpen": true/)
  assert.deepEqual(calls[0], ['state', ['workspace', 'chat', 'browser', 'downloads', 'window'], undefined, 'pane-caller'])
  calls.length = 0
  const narrow = await call('state', { include: ['chat'], pane_id: 'pane-2' })
  assert.doesNotMatch(textOf(narrow), /drawerOpen/)
  assert.deepEqual(calls, [['state', ['chat'], 'pane-2', 'pane-caller']])
})

test('send_message defaults to awaiting the turn and refuses the calling pane', async () => {
  const { calls, call } = harness()
  const result = await call('command', { action: 'send_message', pane_id: 'pane-new', text: 'hello' })
  assert.match(textOf(result), /"turnCompleted": true/)
  assert.deepEqual(calls[0], ['sendMessage', { paneId: 'pane-new', text: 'hello', awaitTurn: true, timeoutMs: 60_000, signal: false }])
  assert.deepEqual(calls[1], ['state', ['chat'], 'pane-new', 'pane-caller'])

  const self = await call('command', { action: 'send_message', pane_id: 'pane-caller', text: 'loop' })
  assert.equal(self.isError, true)
  assert.match(textOf(self), /calling pane/)
  const selected = await call('command', { action: 'stop_agent' }, 'pane-selected')
  assert.equal(selected.isError, true)
  assert.equal(calls.length, 2)
})

test('commands route to the host with the selected pane as the default target', async () => {
  const { calls, call } = harness()
  await call('command', { action: 'new_chat' })
  await call('command', { action: 'stop_agent' })
  await call('command', { action: 'open_chat', title: 'benchmark' })
  await call('command', { action: 'close_chat', pane_id: 'pane-old' })
  await call('command', { action: 'select_model', model_id: 'gpt-5', reasoning_effort: 'high' })
  await call('command', { action: 'browser_tab', op: 'rename', tab_id: '3', tab_title: 'Docs' })
  const verbs = calls.filter((entry) => Array.isArray(entry) && entry[0] !== 'state')
  assert.deepEqual(verbs, [
    ['newChat'],
    ['stopAgent', 'pane-selected'],
    ['openChat', { paneId: undefined, threadId: undefined, title: 'benchmark' }],
    ['closeChat', 'pane-old'],
    ['selectModel', 'pane-selected', 'gpt-5', 'high'],
    ['browserTab', { op: 'rename', tabId: '3', url: undefined, title: 'Docs' }]
  ])
})

test('ui actions resolve controls by id, item, match, selector, or coordinates', async () => {
  const { calls, call } = harness()
  await call('ui', { action: 'controls', surface: 'side-drawer', query: 'row' })
  await call('ui', { action: 'click', control: 'drawer.row', item: 'row-1', fallback_reason: 'Testing the rendered control itself.' })
  await call('ui', { action: 'click', x: 100, y: 200, fallback_reason: 'No manifest control exists at this test point.' })
  await call('ui', { action: 'type', control: 'composer.input', text: 'hello', fallback_reason: 'Testing real composer input.' })
  await call('ui', { action: 'press_key', key: 'Enter', modifiers: ['ctrl'], fallback_reason: 'Testing the renderer shortcut.' })
  await call('ui', { action: 'scroll', delta_y: 400 })
  await call('ui', { action: 'wait_for', control: 'composer.send', condition: 'enabled' })
  assert.deepEqual(calls, [
    ['controls', { surface: 'side-drawer', query: 'row', maxControls: 60 }],
    ['click', { control: 'drawer.row', item: 'row-1', match: undefined, selector: undefined, x: undefined, y: undefined }],
    ['click', { control: undefined, item: undefined, match: undefined, selector: undefined, x: 100, y: 200 }],
    ['typeText', { control: 'composer.input', item: undefined, match: undefined, selector: undefined, text: 'hello', clear: true }],
    ['pressKey', 'Enter', ['ctrl']],
    ['scroll', { control: undefined, item: undefined, match: undefined, selector: undefined, deltaX: 0, deltaY: 400 }],
    ['waitFor', { control: 'composer.send', item: undefined, match: undefined, selector: undefined, text: undefined, condition: 'enabled', timeoutMs: 3_000 }, false]
  ])
})

test('wait marks a timeout as a tool failure and rejects unusable conditions', async () => {
  const timedOut: AppUiHost['waitFor'] = async (options) => ({
    ...options, reached: false, elapsedMs: options.timeoutMs, targetVisible: 0, targetEnabled: 0, textMatched: null
  })
  const { calls, call } = harness({ ui: { waitFor: timedOut } })
  const missing = await call('ui', { action: 'wait_for' })
  assert.equal(missing.isError, true)
  const enabledWithoutTarget = await call('ui', { action: 'wait_for', wait_for_text: 'x', condition: 'enabled' })
  assert.equal(enabledWithoutTarget.isError, true)
  const result = await call('ui', { action: 'wait_for', control: 'dialog.tools', condition: 'hidden', timeout_ms: 250 })
  assert.equal(result.isError, true)
  assert.equal(result.errorKind, 'timeout')
  assert.match(textOf(result), /"reached": false/)
  assert.deepEqual(calls, [])
})

test('schemas reject stale-shaped and oversized arguments before dispatch', async () => {
  const { calls, call } = harness()
  const noTarget = await call('ui', { action: 'click' })
  assert.equal(noTarget.isError, true)
  const badModifier = await call('ui', { action: 'press_key', key: 'Enter', modifiers: ['hyper'], fallback_reason: 'Testing validation.' })
  assert.equal(badModifier.isError, true)
  const badTimeout = await call('ui', { action: 'wait_for', wait_for_text: 'x', timeout_ms: 30_000 })
  assert.equal(badTimeout.isError, true)
  const staleInspect = await call('state', { max_elements: 5 })
  assert.equal(staleInspect.isError, true)
  const badOp = await call('command', { action: 'browser_tab', op: 'navigate' })
  assert.equal(badOp.isError, true)
  assert.deepEqual(calls, [])
})

test('renderer real-input actions require a fallback reason before dispatch', async () => {
  const { calls, call } = harness()
  for (const arguments_ of [
    { action: 'click', control: 'drawer.row' },
    { action: 'type', control: 'composer.input', text: 'hello' },
    { action: 'press_key', key: 'Enter' }
  ]) {
    const result = await call('ui', arguments_)
    assert.equal(result.isError, true)
    assert.match(textOf(result), /fallback_reason/)
  }
  const blank = await call('ui', { action: 'click', control: 'drawer.row', fallback_reason: '   ' })
  assert.equal(blank.isError, true)
  assert.match(textOf(blank), /fallback_reason/)
  assert.deepEqual(calls, [])
})
