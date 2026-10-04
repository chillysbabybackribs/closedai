import assert from 'node:assert/strict'
import test from 'node:test'

import {
  conditionProbeExpression,
  controlsExpression,
  escapeWouldPauseTaskExpression,
  targetBoundsExpression,
  targetClickExpression,
  targetSelector,
  targetTypeExpression,
  targetValueExpression,
  uiStateExpression
} from './app-automation-dom.ts'

const validJavaScript = (expression: string): void => {
  assert.doesNotThrow(() => new Function(`return ${expression}`))
  assert.doesNotMatch(expression, /\sas\sHTML/)
}

test('control listing and ui state are bounded renderer expressions over data-ui ids', () => {
  const listing = controlsExpression({ surface: 'shell', query: 'row', maxControls: 20 })
  validJavaScript(listing)
  assert.match(listing, /querySelectorAll\('\[data-ui\]'\)/)
  assert.match(listing, /"surface":"shell"/)
  assert.match(listing, /"maxControls":20/)
  assert.doesNotMatch(listing, /innerText\s*\|\|\s*document/)
  const state = uiStateExpression()
  validJavaScript(state)
  for (const id of ['composer.input', 'data-can-send', 'composer.stop', 'chat.history']) assert.match(state, new RegExp(id))
  assert.match(state, /data-with-browser/)
})

test('targets become attribute selectors and action expressions stay valid', () => {
  assert.equal(targetSelector({ control: 'titlebar.chat-search-result', item: 'r1' }), '[data-ui="titlebar.chat-search-result"][data-ui-key="r1"]')
  assert.equal(targetSelector({ selector: '.x' }), '.x')
  assert.equal(targetSelector({}), '')
  for (const expression of [
    targetClickExpression({ control: 'composer.stop' }),
    targetTypeExpression({ control: 'composer.input' }, true),
    targetValueExpression({ selector: 'textarea' }),
    conditionProbeExpression({ control: 'dialog.tools', text: 'Tools', condition: 'visible', timeoutMs: 500 })
  ]) validJavaScript(expression)
})

function withDom(elements: unknown[], run: () => Promise<void> | void): Promise<void> | void {
  const originalDocument = globalThis.document
  const originalStyle = globalThis.getComputedStyle
  const originalWindow = globalThis.window
  const originalRaf = (globalThis as Record<string, unknown>).requestAnimationFrame
  Object.assign(globalThis, {
    document: { querySelectorAll: () => elements },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    window: { innerWidth: 1000, innerHeight: 800 },
    requestAnimationFrame: (cb: () => void) => { cb(); return 0 }
  })
  const restore = (): void => {
    Object.assign(globalThis, {
      document: originalDocument,
      getComputedStyle: originalStyle,
      window: originalWindow,
      requestAnimationFrame: originalRaf
    })
  }
  try {
    const result = run()
    if (result instanceof Promise) return result.finally(restore)
    restore()
  } catch (error) {
    restore()
    throw error
  }
}

function fakeElement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const attributes: Record<string, string> = (overrides.attributes as Record<string, string>) ?? {}
  return {
    isConnected: true,
    disabled: false,
    tagName: 'BUTTON',
    innerText: 'Open this chat',
    children: [],
    getAttribute: (name: string) => attributes[name] ?? null,
    scrollIntoView: () => {},
    contains: () => false,
    getClientRects: () => [{ width: 80, height: 30, left: 10, top: 10, right: 90, bottom: 40 }],
    getBoundingClientRect: () => ({ width: 80, height: 30, left: 10, top: 10, right: 90, bottom: 40 }),
    ...overrides
  }
}

test('repeated composer controls resolve to the focused tile', async () => {
  const a = fakeElement({ closest: () => ({ getAttribute: () => 'false' }) })
  const b = fakeElement({ disabled: true, closest: () => ({ getAttribute: () => 'true' }) })
  await withDom([a, b], () => assert.rejects(
    new Function(`return ${targetClickExpression({ control: 'composer.stop' })}`)(),
    /Element is disabled/
  ))
})

test('control resolution names the failure: not rendered, disabled, or ambiguous', async () => {
  const run = (expression: string) => (new Function(`return ${expression}`) as () => Promise<unknown>)()
  await withDom([], () => assert.rejects(run(targetClickExpression({ control: 'dialog.tools' })), /not rendered now/))
  await withDom([fakeElement({ disabled: true })], () =>
    assert.rejects(run(targetClickExpression({ control: 'composer.stop' })), /Element is disabled/))
  const rows = [
    fakeElement({ attributes: { 'data-ui-key': 'a' }, innerText: 'Alpha chat' }),
    fakeElement({ attributes: { 'data-ui-key': 'b' }, innerText: 'Beta chat' })
  ]
  await withDom(rows, () =>
    assert.rejects(run(targetClickExpression({ control: 'titlebar.chat-search-result' })), /matches 2 elements.*Items: a: Alpha chat \| b: Beta chat/))
  await withDom(rows, () =>
    assert.rejects(run(targetClickExpression({ control: 'titlebar.chat-search-result', match: 'gamma' })), /No visible titlebar\.chat-search-result matches "gamma"/))
})

test('ui state reports overview visibility from its pressed control', () => {
  withDom([], () => {
    for (const pressed of ['true', 'false', null]) {
      const overview = fakeElement({
        attributes: { 'aria-pressed': pressed }, closest: () => null
      })
      Object.assign(globalThis, { document: {
        querySelector: () => null,
        querySelectorAll: (selector: string) => selector === '[data-ui="dock.overview"]' ? [overview] : []
      } })
      const state = new Function(`return ${uiStateExpression()}`)() as { overviewOpen: boolean }
      assert.equal(state.overviewOpen, pressed === 'true')
    }
  })
})

test('ui state reports rendered chat zoom and null without a chat', () => {
  withDom([], () => {
    for (const zoom of ['100', '110', null]) {
      const chat = fakeElement({ attributes: { 'data-zoom': zoom }, closest: () => null })
      Object.assign(globalThis, { document: {
        querySelector: () => null,
        querySelectorAll: (selector: string) => selector === '[data-ui-surface="chat"][data-zoom]' && zoom ? [chat] : []
      } })
      const state = new Function(`return ${uiStateExpression()}`)() as { chatZoom: number | null }
      assert.equal(state.chatZoom, zoom ? Number(zoom) : null)
    }
  })
})

test('ui state reads browser visibility from the workspace, not the titlebar toggle', () => {
  const browserDock = fakeElement({
    attributes: { 'data-mode': 'browser', 'data-with-browser': 'no' },
    closest: () => null
  })
  withDom([], () => {
    const originalDocument = globalThis.document
    Object.assign(globalThis, {
      document: {
        querySelector: (selector: string) => (selector.includes('workspace-right') ? browserDock : null),
        querySelectorAll: () => []
      }
    })
    try {
      const state = new Function(`return ${uiStateExpression()}`)() as { layout: { browserVisible: boolean } }
      assert.equal(state.layout.browserVisible, false)
    } finally {
      Object.assign(globalThis, { document: originalDocument })
    }
  })
})

test('ui state lists only tiles that are shown, not ones a view tab or hidden layout covers', () => {
  const tile = (paneId: string, shown: boolean) => fakeElement({
    tagName: 'SECTION', attributes: { 'data-pane-id': paneId }, closest: () => null,
    getClientRects: () => (shown ? [{ width: 400, height: 300, left: 0, top: 0, right: 400, bottom: 300 }] : [])
  })
  withDom([], () => {
    const originalDocument = globalThis.document
    Object.assign(globalThis, {
      document: {
        querySelector: () => null,
        querySelectorAll: (selector: string) => (selector === '[data-pane-id]' ? [tile('pane-a', true), tile('pane-b', false)] : [])
      }
    })
    try {
      const state = new Function(`return ${uiStateExpression()}`)() as { layout: { visiblePaneIds: string[] } }
      assert.deepEqual(state.layout.visiblePaneIds, ['pane-a'])
    } finally {
      Object.assign(globalThis, { document: originalDocument })
    }
  })
})

test('control listing reports the owning pane and lists each surface once', () => {
  const inPane = (paneId: string) => fakeElement({
    tagName: 'TEXTAREA', attributes: { 'data-ui': 'composer.input' }, value: '',
    closest: (selector: string) => selector.includes('data-pane-id')
      ? { getAttribute: (name: string) => (name === 'data-pane-id' ? paneId : 'true') }
      : selector.includes('data-ui-surface') ? { getAttribute: () => 'chat' } : null
  })
  const surface = fakeElement({ tagName: 'SECTION', attributes: { 'data-ui-surface': 'chat' }, closest: () => null })
  withDom([], () => {
    const originalDocument = globalThis.document
    Object.assign(globalThis, {
      document: {
        querySelector: () => null,
        querySelectorAll: (selector: string) => (selector === '[data-ui]' ? [inPane('pane-a'), inPane('pane-b')]
          : selector === '[data-ui-surface]' ? [surface, surface] : [])
      }
    })
    try {
      const listing = new Function(`return ${controlsExpression({ maxControls: 20 })}`)() as {
        surfaces: string[]; controls: Array<{ id: string; pane?: string }>
      }
      assert.deepEqual(listing.surfaces, ['chat'])
      assert.deepEqual(listing.controls.map((control) => [control.id, control.pane]), [['composer.input', 'pane-a'], ['composer.input', 'pane-b']])
    } finally {
      Object.assign(globalThis, { document: originalDocument })
    }
  })
})

test('control listing names switches and inputs from their native labels', () => {
  const toggle = fakeElement({
    attributes: { 'data-ui': 'security.secrets-keychain', role: 'switch', 'aria-checked': 'false' },
    innerText: '', labels: [{ innerText: 'Only save secrets when the OS keychain is available' }], closest: () => null
  })
  withDom([], () => {
    const originalDocument = globalThis.document
    Object.assign(globalThis, {
      document: { querySelector: () => null, querySelectorAll: (selector: string) => (selector === '[data-ui]' ? [toggle] : []) }
    })
    try {
      const listing = new Function(`return ${controlsExpression({ maxControls: 5 })}`)() as {
        surfaces: string[]; controls: Array<{ name: string; checked?: boolean }>
      }
      assert.deepEqual(listing.controls.map((control) => [control.name, control.checked]),
        [['Only save secrets when the OS keychain is available', false]])
      // A portalled dialog control sits outside every tagged surface; the listing still names overlay.
      assert.deepEqual(listing.surfaces, ['overlay'])
    } finally {
      Object.assign(globalThis, { document: originalDocument })
    }
  })
})

test('ui state names a portalled menu by its trigger control and lists it once', () => {
  const trigger = fakeElement({ attributes: { 'data-ui': 'titlebar.menu', 'data-state': 'open' }, closest: () => null })
  const content = fakeElement({ tagName: 'DIV', attributes: { 'aria-labelledby': 'trigger-1' }, closest: () => null })
  withDom([], () => {
    const originalDocument = globalThis.document
    Object.assign(globalThis, {
      document: {
        querySelector: () => null,
        querySelectorAll: (selector: string) => (selector.includes('[role="menu"]') ? [content, trigger] : []),
        getElementById: (id: string) => (id === 'trigger-1' ? trigger : null)
      }
    })
    try {
      const state = new Function(`return ${uiStateExpression()}`)() as { menus: string[] }
      assert.deepEqual(state.menus, ['titlebar.menu'])
      const listbox = fakeElement({
        tagName: 'DIV', attributes: { role: 'listbox', 'aria-label': 'Suggestions' }, closest: () => null,
        parentElement: { closest: () => ({ getAttribute: (name: string) => (name === 'aria-label' ? 'Chat setup' : null) }) }
      })
      Object.assign(globalThis.document, {
        querySelectorAll: (selector: string) => (selector.includes('[role="menu"]') ? [listbox] : [])
      })
      const popover = new Function(`return ${uiStateExpression()}`)() as { menus: string[] }
      assert.deepEqual(popover.menus, ['Chat setup'])
    } finally {
      Object.assign(globalThis, { document: originalDocument })
    }
  })
})

test('agent strip controls resolve in a visible tile without data-selected', async () => {
  const run = (expression: string) => (new Function(`return ${expression}`) as () => Promise<unknown>)()
  const strip = fakeElement({
    attributes: { 'data-ui': 'chat.agent-resume' },
    closest: (selector: string) => selector.includes('data-pane-id')
      ? { getAttribute: (attr: string) => (attr === 'data-selected' ? 'false' : 'pane-agent') }
      : null
  })
  await withDom([strip], async () => {
    const originalFromPoint = globalThis.document.elementFromPoint
    globalThis.document.elementFromPoint = () => strip as unknown as Element
    try {
      await run(targetClickExpression({ control: 'chat.agent-resume' }))
    } finally {
      globalThis.document.elementFromPoint = originalFromPoint
    }
  })
})

test('control resolution diagnoses elements belonging to unselected panes', async () => {
  const run = (expression: string) => (new Function(`return ${expression}`) as () => Promise<unknown>)()
  const otherPane = fakeElement({
    closest: (selector: string) => selector.includes('data-pane-id') ? {
      getAttribute: (attr: string) => attr === 'data-selected' ? 'false' : attr === 'data-pane-id' ? 'pane-other' : null
    } : null
  })
  await withDom([otherPane], () =>
    assert.rejects(run(targetClickExpression({ control: 'composer.stop' })), /belongs to unselected pane pane-other/))
})

test('pane selection is read from the layout tile, not the chat-pane aside nested inside it', async () => {
  // The aside carries data-pane-id without data-selected; only the tile says whether the pane is selected.
  const aside = { getAttribute: (attr: string) => attr === 'data-pane-id' ? 'pane-a' : null }
  const tile = { getAttribute: (attr: string) => attr === 'data-selected' ? 'true' : attr === 'data-pane-id' ? 'pane-a' : null }
  const input = fakeElement({
    attributes: { 'data-ui': 'composer.input' },
    closest: (selector: string) => selector.includes('[data-selected]') ? tile : selector.includes('data-pane-id') ? aside : null
  })
  await withDom([input], async () => {
    const located = await new Function(`return ${targetBoundsExpression({ control: 'composer.input' })}`)() as { bounds: unknown }
    assert.deepEqual(located.bounds, { x: 10, y: 10, width: 80, height: 30 })
  })
})

test('click preparation falls back to an uncovered child when a sibling floats over the centre', async () => {
  const run = (expression: string) => (new Function(`return ${expression}`) as () => Promise<{ point: { x: number; y: number } }>)()
  const label = fakeElement({ tagName: 'SPAN', getBoundingClientRect: () => ({ width: 30, height: 20, left: 12, top: 15, right: 42, bottom: 35 }) })
  const target = fakeElement({
    attributes: { 'data-ui': 'composer.setup' },
    getClientRects: () => [{ width: 400, height: 30, left: 10, top: 10, right: 410, bottom: 40 }],
    getBoundingClientRect: () => ({ width: 400, height: 30, left: 10, top: 10, right: 410, bottom: 40 }),
    children: [label],
    contains: (node: unknown) => node === label
  })
  const floating = fakeElement({ attributes: { 'data-ui': 'composer.agents' } })
  await withDom([target], async () => {
    const originalFromPoint = globalThis.document.elementFromPoint
    globalThis.document.elementFromPoint = (x: number) => (x > 100 && x < 320 ? floating : label) as unknown as Element
    try {
      const prepared = await run(targetClickExpression({ control: 'composer.setup' }))
      assert.deepEqual(prepared.point, { x: 27, y: 25 })
    } finally {
      globalThis.document.elementFromPoint = originalFromPoint
    }
  })
})

test('escape pause probe matches overlay ownership and running turns', () => {
  withDom([], () => {
    const originalDocument = globalThis.document
    const stop = fakeElement({ attributes: { 'data-ui': 'composer.stop' } })
    Object.assign(globalThis, {
      document: {
        querySelector: (selector: string) => {
          if (selector.includes('composer.stop')) return stop
          if (selector.includes('role="menu"')) return null
          return null
        },
        querySelectorAll: () => [],
        body: { hasAttribute: () => false }
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
    })
    try {
      const idle = new Function(`return ${escapeWouldPauseTaskExpression()}`)() as boolean
      assert.equal(idle, true)
      Object.assign(globalThis.document, {
        querySelector: (selector: string) => (selector.includes('role="menu"') ? stop : selector.includes('composer.stop') ? stop : null)
      })
      const menuOpen = new Function(`return ${escapeWouldPauseTaskExpression()}`)() as boolean
      assert.equal(menuOpen, false)
    } finally {
      Object.assign(globalThis, { document: originalDocument })
    }
  })
})

test('click preparation reports covering elements', async () => {
  const run = (expression: string) => (new Function(`return ${expression}`) as () => Promise<unknown>)()
  const target = fakeElement({ attributes: { 'data-ui': 'target.button' } })
  const overlay = fakeElement({ attributes: { 'data-ui': 'modal.overlay' } })
  await withDom([target], () => {
    const originalFromPoint = globalThis.document.elementFromPoint
    globalThis.document.elementFromPoint = () => overlay as unknown as Element
    return assert.rejects(
      run(targetClickExpression({ control: 'target.button' })),
      /covered at its clickable center by \[data-ui="modal\.overlay"\]/
    ).finally(() => {
      globalThis.document.elementFromPoint = originalFromPoint
    })
  })
})

test('controls with layout report bounds, overflow, and offscreen; bounds resolve one target', () => {
  const tab = fakeElement({
    attributes: { 'data-ui': 'layout.tab', 'data-ui-key': 'tab-1' },
    closest: () => null,
    clientWidth: 80, scrollWidth: 140.5, clientHeight: 30, scrollHeight: 30,
    getBoundingClientRect: () => ({ width: 80.4, height: 30, left: 960.2, top: 10, right: 1040.6, bottom: 40 })
  })
  return withDom([tab], async () => {
    const plain = new Function(`return ${controlsExpression({ maxControls: 5 })}`)() as { controls: Array<Record<string, unknown>> }
    assert.equal(plain.controls[0]?.bounds, undefined)
    const laid = new Function(`return ${controlsExpression({ maxControls: 5, layout: true })}`)() as { controls: Array<Record<string, unknown>> }
    assert.deepEqual(laid.controls[0]?.bounds, { x: 960, y: 10, width: 80, height: 30 })
    assert.deepEqual(laid.controls[0]?.overflow, { x: 60.5, y: 0 })
    assert.equal(laid.controls[0]?.partlyOffscreen, true)
    const located = await new Function(`return ${targetBoundsExpression({ control: 'layout.tab' })}`)()
    assert.deepEqual(located, { bounds: { x: 960, y: 10, width: 80, height: 30 }, viewport: { width: 1000, height: 800 } })
    // A failed lookup must reject with its reason, not Electron's generic "Script failed to execute".
    await assert.rejects(new Function(`return ${targetBoundsExpression({})}`)(), /Pass control/)
  })
})
