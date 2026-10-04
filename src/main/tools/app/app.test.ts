import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { emptyAgentRunStats } from '../../../shared/agent-runs.js'
import { uiControlFamilies } from '../../../shared/ui-controls.js'
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
        fullScreen: false, chatZoom: 100, overviewOpen: false, chatSearchOpen: true, historyOpen: false, downloadsOpen: false, dialogs: [], menus: [],
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
    revealChatTab: async (paneId) => { calls.push(['revealChatTab', paneId]) },
    revealBrowser: async () => { calls.push(['revealBrowser']) },
    newChatWindow: async () => { calls.push(['newChatWindow']); return { paneId: 'pane-new' } },
    runMenu: async (key, callerPaneId) => { calls.push(['runMenu', key, callerPaneId]); return { key, ran: true } },
    consoleMessages: (filter) => {
      calls.push(['consoleMessages', filter])
      return { matched: 0, returned: 0, nextCursor: 0, lastNavigationAt: null, entries: [] }
    },
    ...overrides.ui
  }
  const app: AppCommandHost = {
    state: (sections, paneId, callerPaneId) => {
      calls.push(['state', sections, paneId, callerPaneId])
      return Object.fromEntries(sections.map((section) => [section, { section }]))
    },
    buildFreshness: async () => ({
      mode: 'checkout', basis: 'bundle-digest', mainStale: true, preloadStale: false, rendererStale: false, rendererLoadedAt: null
    }),
    selectedPaneId: () => 'pane-selected',
    queueProjectSwitch: async (request) => { calls.push(['queueProjectSwitch', request]); return { ...request, status: 'pending' } },
    cancelProjectSwitch: (paneId) => { calls.push(['cancelProjectSwitch', paneId]); return null },
    newChat: async () => { calls.push(['newChat']); return { paneId: 'pane-new' } },
    sendMessage: async (request) => {
      calls.push(['sendMessage', { ...request, signal: request.signal.aborted }])
      return { paneId: request.paneId, turnStarted: true, turnCompleted: true, elapsedMs: 1200 }
    },
    stopAgent: async (paneId) => { calls.push(['stopAgent', paneId]) },
    agentRun: async (request) => {
      calls.push(['agentRun', request])
      if (request.op === 'stop') return null
      return {
        chatId: request.paneId, prompt: request.op === 'start' ? request.options.prompt ?? 'saved' : 'standing', status: request.op === 'pause' || request.op === 'finish' ? 'paused' : 'running',
        cycle: 1, maxCycles: request.op === 'start' ? request.options.maxCycles ?? null : null,
        maxMinutes: request.op === 'start' ? request.options.maxMinutes ?? null : null, activeMs: 0, activeSince: null,
        autonomous: request.op === 'start' ? request.options.autonomous !== false : true,
        startedAt: 1, updatedAt: 1, lastTurnEndedAt: null, reason: request.op === 'finish' ? `Finished: ${request.summary}` : null, failures: 0, threadId: null,
        agentId: request.op === 'start' ? request.agentId : null, name: null, stats: emptyAgentRunStats()
      }
    },
    openChat: async (request) => { calls.push(['openChat', request]); return { paneId: request.paneId ?? 'pane-selected', threadId: 'thread-1' } },
    closeChat: async (paneId) => { calls.push(['closeChat', paneId]) },
    selectModel: async (paneId, modelId, effort) => { calls.push(['selectModel', paneId, modelId, effort]) },
    browserTab: async (request) => { calls.push(['browserTab', request]); return { tabCount: 1 } },
    ...overrides.app
  }
  const page = {
    navigate: async () => ({
      ok: true as const,
      tabId: 'tab-preview',
      ready: {
        url: 'file:///mock.html', title: 'mock', elapsedMs: 0,
        readyState: 'complete', reached: true, conditionMet: null
      }
    }),
    listTabs: () => [],
    readPage: async () => null,
    fetchPage: async () => null,
    waitFor: async () => null,
    evaluate: async () => null,
    query: async () => null,
    consoleMessages: () => null
  }
  const registry = new ToolRegistry([appTools(() => app, () => ui, () => page)])
  const call = (tool: string, arguments_: Record<string, unknown>, paneId: string | null = 'pane-caller') => registry.call(
    { namespace: 'closedai_app', tool, arguments: arguments_ },
    { threadId: null, turnId: null, callId: 'app-call', paneId, source: 'exec' }
  )
  return { calls, call, registry }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('namespace advertises state, deterministic commands, and control-level ui actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['closedai_app.state', 'closedai_app.command', 'closedai_app.menu', 'closedai_app.agent', 'closedai_app.ui'])
  const [state, command, menu, agent, ui] = registry.namespaces[0]!.tools
  assert.equal(state!.actions, undefined)
  assert.equal(menu!.actions, undefined)
  assert.deepEqual(command!.actions?.map((action) => action.name), [
    'project_switch', 'new_chat', 'send_message', 'stop_agent', 'open_chat', 'close_chat', 'select_model', 'browser_tab'
  ])
  assert.deepEqual(agent!.actions?.map((action) => action.name), ['start', 'pause', 'resume', 'finish', 'stop'])
  assert.deepEqual(ui!.actions?.map((action) => action.name), [
    'controls', 'click', 'type', 'press_key', 'scroll', 'wait_for', 'console'
  ])
  assert.match(ui!.description, new RegExp(`families: ${uiControlFamilies().join(', ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
})

test('state returns every section by default and only the requested ones otherwise', async () => {
  const { calls, call } = harness()
  const full = await call('state', {})
  assert.match(textOf(full), /"chatSearchOpen": true/)
  assert.deepEqual(calls[0], ['state', ['workspace', 'chat', 'browser', 'downloads', 'window'], undefined, 'pane-caller'])
  calls.length = 0
  const narrow = await call('state', { include: ['chat'], pane_id: 'pane-2' })
  assert.doesNotMatch(textOf(narrow), /chatSearchOpen/)
  assert.deepEqual(calls, [['state', ['chat'], 'pane-2', 'pane-caller']])
})

test('state reports build freshness under workspace only', async () => {
  const { call } = harness()
  assert.match(textOf(await call('state', { include: ['workspace'] })), /"build": \{[^}]*"mainStale": true/)
  assert.doesNotMatch(textOf(await call('state', { include: ['chat'] })), /mainStale/)
})

test('console reads the main window by default and passes filters through', async () => {
  const { calls, call } = harness()
  await call('ui', { action: 'console' })
  await call('ui', { action: 'console', window: 'win-2', min_level: 'error', since_navigation: true, after_cursor: 4, max_entries: 5 })
  assert.deepEqual(calls, [
    ['consoleMessages', { tabId: 'main', minLevel: undefined, contains: undefined, sinceNavigation: false, afterCursor: undefined, limit: 50 }],
    ['consoleMessages', { tabId: 'win-2', minLevel: 'error', contains: undefined, sinceNavigation: true, afterCursor: 4, limit: 5 }]
  ])
})

test('project switch binds to caller identity and cancellation needs no live turn', async () => {
  const { calls, registry, call } = harness()
  const result = await registry.call({
    namespace: 'closedai_app', tool: 'command',
    arguments: { action: 'project_switch', project_op: 'request', project_path: '/destination' }
  }, { paneId: 'source', threadId: 'thread', turnId: 'turn', callId: 'switch', source: 'exec' })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], ['queueProjectSwitch', {
    paneId: 'source', threadId: 'thread', turnId: 'turn', projectPath: '/destination'
  }])
  assert.match(textOf(await call('command', {
    action: 'project_switch', project_op: 'request', project_path: '/destination'
  })), /current calling thread and turn/)
  await call('command', { action: 'project_switch', project_op: 'cancel' })
  assert.deepEqual(calls.at(-1), ['cancelProjectSwitch', 'pane-caller'])
})

test('send_message defaults to awaiting the turn and refuses the calling pane', async () => {
  const { calls, call } = harness()
  const result = await call('command', { action: 'send_message', pane_id: 'pane-new', text: 'hello' })
  assert.match(textOf(result), /"turnCompleted": true/)
  assert.deepEqual(calls[0], ['sendMessage', {
    paneId: 'pane-new', text: 'hello', awaitTurn: true, timeoutMs: 60_000, signal: false
  }])
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

test('menu runs a row by key for the caller and returns the ui state once it changes', async () => {
  let dialogs: string[] = []
  const { calls, call } = harness({ ui: {
    uiState: async () => {
      calls.push(['uiState'])
      return { fullScreen: false, chatZoom: 100, overviewOpen: false, chatSearchOpen: false, historyOpen: false, downloadsOpen: false, dialogs, menus: [], composer: null, focused: null, viewport: { width: 1, height: 1 } }
    },
    runMenu: async (key, callerPaneId) => {
      calls.push(['runMenu', key, callerPaneId])
      if (key === 'tile-windows') return { key, label: 'Tile windows (full workspace)', menu: 'View', ran: false, disabled: true }
      if (key === 'settings') setTimeout(() => { dialogs = ['dialog.settings'] }, 150)
      return { key, ran: true }
    }
  } })
  const ran = await call('menu', { key: 'settings' })
  assert.equal(ran.isError, undefined)
  assert.match(textOf(ran), /"uiChanged": true/)
  assert.match(textOf(ran), /dialog\.settings/)
  assert.deepEqual(calls.slice(0, 3), [['uiState'], ['runMenu', 'settings', 'pane-caller'], ['uiState']])
  calls.length = 0
  const greyed = await call('menu', { key: 'tile-windows' })
  assert.match(textOf(greyed), /"disabled": true/)
  assert.deepEqual(calls, [['uiState'], ['runMenu', 'tile-windows', 'pane-caller']])
  const unseen = await call('menu', { key: 'toggle-full-screen' })
  assert.match(textOf(unseen), /"uiChanged": false/)
  for (const key of ['reload-renderer', 'close-window', 'no-such-row']) {
    const refused = await call('menu', { key })
    assert.equal(refused.isError, true, key)
  }
})

test('finish ends only the calling pane\'s own run', async () => {
  const { calls, call } = harness()
  const finished = await call('agent', { action: 'finish', summary: 'ledger complete' })
  assert.equal(finished.isError, undefined)
  assert.match(textOf(finished), /Finished: ledger complete/)
  assert.deepEqual(calls, [['agentRun', { op: 'finish', paneId: 'pane-caller', summary: 'ledger complete' }]])
  const anonymous = await call('agent', { action: 'finish', summary: 'done' }, null)
  assert.equal(anonymous.isError, true)
  assert.match(textOf(anonymous), /calling chat/)
})

test('agent actions drive another pane\'s run and refuse the calling pane', async () => {
  const { calls, call } = harness()
  const started = await call('agent', { action: 'start', pane_id: 'pane-agent', prompt: 'repair the app', max_cycles: 3 })
  assert.equal(started.isError, undefined)
  assert.match(textOf(started), /"status": "running"/)
  await call('agent', { action: 'pause', pane_id: 'pane-agent' })
  await call('agent', { action: 'resume', pane_id: 'pane-agent' })
  const stopped = await call('agent', { action: 'stop', pane_id: 'pane-agent' })
  assert.match(textOf(stopped), /"run": null/)
  const verbs = calls.flatMap((entry) => Array.isArray(entry) && entry[0] === 'agentRun' ? [entry[1]] : [])
  assert.deepEqual(verbs, [
    { op: 'start', paneId: 'pane-agent', agentId: null, options: { prompt: 'repair the app', maxCycles: 3 } },
    { op: 'pause', paneId: 'pane-agent' },
    { op: 'resume', paneId: 'pane-agent' },
    { op: 'stop', paneId: 'pane-agent' }
  ])
  const self = await call('agent', { action: 'start', prompt: 'loop' }, 'pane-selected')
  assert.equal(self.isError, true)
  assert.match(textOf(self), /pane_id is required|needs pane_id/)
  const onCaller = await call('agent', { action: 'start', pane_id: 'pane-selected', prompt: 'loop' }, 'pane-selected')
  assert.equal(onCaller.isError, true)
  assert.match(textOf(onCaller), /calling pane/)
  const missingPrompt = await call('agent', { action: 'start', pane_id: 'pane-agent' })
  assert.equal(missingPrompt.isError, true)
  assert.match(textOf(missingPrompt), /agent_id/)
  calls.length = 0
  await call('agent', { action: 'start', pane_id: 'pane-agent', agent_id: 'saved-1' })
  assert.deepEqual(calls.filter((entry) => Array.isArray(entry) && entry[0] === 'agentRun').map((entry) => (entry as unknown[])[1]), [
    { op: 'start', paneId: 'pane-agent', agentId: 'saved-1', options: {} }
  ])
})

test('menu detects overview visibility changes without a second model lookup', async () => {
  let overviewOpen = false
  let reads = 0
  const { call } = harness({ ui: {
    uiState: async () => {
      reads += 1
      return {
        fullScreen: false, chatZoom: 100, overviewOpen, chatSearchOpen: false, historyOpen: false, downloadsOpen: false,
        dialogs: [], menus: [], composer: null, focused: null, viewport: { width: 1, height: 1 }
      }
    },
    runMenu: async (key) => { overviewOpen = !overviewOpen; return { key, ran: true } }
  } })
  for (const expected of [true, false]) {
    const result = JSON.parse(textOf(await call('menu', { key: 'overview' })))
    assert.equal(result.uiChanged, true)
    assert.equal(result.ui.overviewOpen, expected)
  }
  assert.equal(reads, 4)
})

test('menu detects chat zoom changes without waiting for unrelated UI changes', async () => {
  let chatZoom = 100
  let reads = 0
  const { call } = harness({ ui: {
    uiState: async () => {
      reads += 1
      return {
        fullScreen: false, chatZoom, overviewOpen: false, chatSearchOpen: false, historyOpen: false, downloadsOpen: false,
        dialogs: [], menus: [], composer: null, focused: null, viewport: { width: 1, height: 1 }
      }
    },
    runMenu: async (key) => { chatZoom += key === 'zoom-in' ? 10 : -10; return { key, ran: true } }
  } })
  for (const [key, expected] of [['zoom-in', 110], ['zoom-out', 100]] as const) {
    const result = JSON.parse(textOf(await call('menu', { key })))
    assert.equal(result.uiChanged, true)
    assert.equal(result.ui.chatZoom, expected)
  }
  assert.equal(reads, 4)
})

test('menu detects native full-screen changes', async () => {
  let fullScreen = false
  let reads = 0
  const { call } = harness({ ui: {
    uiState: async () => {
      reads += 1
      return {
        fullScreen, chatZoom: 100, overviewOpen: false, chatSearchOpen: false,
        historyOpen: false, downloadsOpen: false, dialogs: [], menus: [],
        composer: null, focused: null, viewport: { width: 1, height: 1 }
      }
    },
    runMenu: async (key) => { fullScreen = !fullScreen; return { key, ran: true } }
  } })
  for (const expected of [true, false]) {
    const result = JSON.parse(textOf(await call('menu', { key: 'toggle-full-screen' })))
    assert.equal(result.uiChanged, true)
    assert.equal(result.ui.fullScreen, expected)
  }
  assert.equal(reads, 4)
})

test('preview_html resolves workspace html and reveals the browser when hidden', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'closedai-app-preview-'))
  await writeFile(path.join(cwd, 'mock.html'), '<!doctype html><title>mock</title>')
  const { calls, call } = harness({
    app: {
      state: (sections) => (sections.includes('chat') ? { chat: { cwd } } : {})
    },
    ui: {
      uiState: async () => ({
        fullScreen: false, chatZoom: 100, overviewOpen: false, chatSearchOpen: false, historyOpen: false, downloadsOpen: false, dialogs: [], menus: [],
        layout: { visiblePaneIds: ['pane-caller'], browserVisible: false },
        composer: null, focused: null, viewport: { width: 1200, height: 800 }
      })
    }
  })
  const result = await call('command', { action: 'browser_tab', op: 'preview_html', path: 'mock.html' })
  assert.equal(result.isError, undefined)
  assert.match(textOf(result), /mock\.html/)
  assert.match(textOf(result), /tab-preview/)
  // The pane is shown through the ui host, not by clicking a control a layout may not render.
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === 'revealBrowser'))
  assert.ok(!calls.some((entry) => Array.isArray(entry) && entry[0] === 'click'))
  assert.match(textOf(result), /"browserRevealed": true/)
})

test('preview_html reports browserRevealed when opening the tab already showed the hidden pane', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'closedai-app-preview-'))
  await writeFile(path.join(cwd, 'mock.html'), '<!doctype html><title>mock</title>')
  let visible = false
  const { calls, call } = harness({
    app: { state: (sections) => (sections.includes('chat') ? { chat: { cwd } } : {}) },
    ui: {
      uiState: async () => {
        const layout = { visiblePaneIds: ['pane-caller'], browserVisible: visible }
        visible = true // the renderer shows the pane as soon as the new tab appears
        return {
          fullScreen: false, chatZoom: 100, overviewOpen: false, chatSearchOpen: false, historyOpen: false, downloadsOpen: false, dialogs: [], menus: [],
          layout, composer: null, focused: null, viewport: { width: 1200, height: 800 }
        }
      }
    }
  })
  const result = await call('command', { action: 'browser_tab', op: 'preview_html', path: 'mock.html' })
  assert.equal(result.isError, undefined)
  assert.match(textOf(result), /"browserRevealed": true/)
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === 'revealBrowser'), false)
})

test('preview_html leaves a visible browser pane alone', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'closedai-app-preview-'))
  await writeFile(path.join(cwd, 'mock.html'), '<!doctype html><title>mock</title>')
  const { calls, call } = harness({
    app: { state: (sections) => (sections.includes('chat') ? { chat: { cwd } } : {}) },
    ui: {
      uiState: async () => ({
        fullScreen: false, chatZoom: 100, overviewOpen: false, chatSearchOpen: false, historyOpen: false, downloadsOpen: false, dialogs: [], menus: [],
        layout: { visiblePaneIds: ['pane-caller'], browserVisible: true },
        composer: null, focused: null, viewport: { width: 1200, height: 800 }
      })
    }
  })
  const result = await call('command', { action: 'browser_tab', op: 'preview_html', path: 'mock.html' })
  assert.match(textOf(result), /"browserRevealed": false/)
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === 'revealBrowser'), false)
})

test('preview_html without a path names the missing argument', async () => {
  const { call } = harness()
  const result = await call('command', { action: 'browser_tab', op: 'preview_html' })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /path is required for preview_html/)
})

test('ui actions resolve controls by id, item, match, selector, or coordinates', async () => {
  const { calls, call } = harness()
  await call('ui', { action: 'controls', surface: 'shell', query: 'row' })
  await call('ui', { action: 'controls', query: 'composer', layout: true })
  await call('ui', { action: 'click', control: 'titlebar.chat-search-result', item: 'row-1', fallback_reason: 'Testing the rendered control itself.' })
  await call('ui', { action: 'click', x: 100, y: 200, fallback_reason: 'No manifest control exists at this test point.' })
  await call('ui', { action: 'type', control: 'composer.input', text: 'hello', fallback_reason: 'Testing real composer input.' })
  await call('ui', { action: 'press_key', key: 'Enter', modifiers: ['ctrl'], fallback_reason: 'Testing the renderer shortcut.' })
  await call('ui', { action: 'scroll', delta_y: 400 })
  await call('ui', { action: 'wait_for', control: 'composer.stop', condition: 'enabled' })
  assert.deepEqual(calls, [
    ['controls', { surface: 'shell', query: 'row', maxControls: 60, layout: false }],
    ['controls', { surface: undefined, query: 'composer', maxControls: 60, layout: true }],
    ['click', { control: 'titlebar.chat-search-result', item: 'row-1', match: undefined, selector: undefined, x: undefined, y: undefined }],
    ['click', { control: undefined, item: undefined, match: undefined, selector: undefined, x: 100, y: 200 }],
    ['typeText', { control: 'composer.input', item: undefined, match: undefined, selector: undefined, text: 'hello', clear: true }],
    ['pressKey', 'Enter', ['ctrl']],
    ['scroll', { control: undefined, item: undefined, match: undefined, selector: undefined, deltaX: 0, deltaY: 400 }],
    ['waitFor', { control: 'composer.stop', item: undefined, match: undefined, selector: undefined, text: undefined, condition: 'enabled', timeoutMs: 3_000 }, false]
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

test('direct-call providers must dispatch renderer input through tool_batch', async () => {
  const { calls, registry } = harness()
  const result = await registry.call(
    {
      namespace: 'closedai_app',
      tool: 'ui',
      arguments: { action: 'click', control: 'titlebar.chat-search-result', fallback_reason: 'Testing a rendered interaction.' }
    },
    { threadId: null, turnId: null, callId: 'app-direct', paneId: 'pane-caller', source: 'model' }
  )
  assert.equal(result.isError, true)
  assert.match(textOf(result), /tool_batch\.run/)
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
    { action: 'click', control: 'titlebar.chat-search-result' },
    { action: 'type', control: 'composer.input', text: 'hello' },
    { action: 'press_key', key: 'Enter' }
  ]) {
    const result = await call('ui', arguments_)
    assert.equal(result.isError, true)
    assert.match(textOf(result), /fallback_reason/)
  }
  const blank = await call('ui', { action: 'click', control: 'titlebar.chat-search-result', fallback_reason: '   ' })
  assert.equal(blank.isError, true)
  assert.match(textOf(blank), /fallback_reason/)
  assert.deepEqual(calls, [])
})
