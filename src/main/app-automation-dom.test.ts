import assert from 'node:assert/strict'
import test from 'node:test'

import {
  conditionProbeExpression,
  controlsExpression,
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
    getAttribute: (name: string) => attributes[name] ?? null,
    scrollIntoView: () => {},
    contains: () => false,
    getClientRects: () => [{ width: 80, height: 30, left: 10, top: 10, right: 90, bottom: 40 }],
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
