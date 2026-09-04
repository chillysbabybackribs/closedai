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
  const listing = controlsExpression({ surface: 'side-drawer', query: 'row', maxControls: 20 })
  validJavaScript(listing)
  assert.match(listing, /querySelectorAll\('\[data-ui\]'\)/)
  assert.match(listing, /"surface":"side-drawer"/)
  assert.match(listing, /"maxControls":20/)
  assert.doesNotMatch(listing, /innerText\s*\|\|\s*document/)
  const state = uiStateExpression()
  validJavaScript(state)
  for (const id of ['composer.input', 'composer.send', 'composer.stop', 'chat.history']) assert.match(state, new RegExp(id))
})

test('targets become attribute selectors and action expressions stay valid', () => {
  assert.equal(targetSelector({ control: 'drawer.row', item: 'r1' }), '[data-ui="drawer.row"][data-ui-key="r1"]')
  assert.equal(targetSelector({ selector: '.x' }), '.x')
  assert.equal(targetSelector({}), '')
  for (const expression of [
    targetClickExpression({ control: 'composer.send' }),
    targetTypeExpression({ control: 'composer.input' }, true),
    targetValueExpression({ selector: 'textarea' }),
    conditionProbeExpression({ control: 'dialog.tools', text: 'Tools', condition: 'visible', timeoutMs: 500 })
  ]) validJavaScript(expression)
})

function withDom(elements: unknown[], run: () => Promise<void> | void): Promise<void> | void {
  const originalDocument = globalThis.document
  const originalStyle = globalThis.getComputedStyle
  const originalWindow = globalThis.window
  Object.assign(globalThis, {
    document: { querySelectorAll: () => elements },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    window: { innerWidth: 1000, innerHeight: 800 }
  })
  const restore = (): void => {
    Object.assign(globalThis, { document: originalDocument, getComputedStyle: originalStyle, window: originalWindow })
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
    getClientRects: () => [{ width: 80, height: 30, left: 10, top: 10, right: 90, bottom: 40 }],
    ...overrides
  }
}

test('repeated composer controls resolve to the focused tile', () => {
  const a = fakeElement({ value: 'draft A', closest: () => ({ getAttribute: () => 'false' }) })
  const b = fakeElement({ value: 'draft B', closest: () => ({ getAttribute: () => 'true' }) })
  withDom([a, b], () => {
    const result = new Function(`return ${targetValueExpression({ control: 'composer.input' })}`)()
    assert.equal(result, 'draft B')
  })
})

test('control resolution names the failure: not rendered, disabled, or ambiguous', async () => {
  const run = (expression: string) => (new Function(`return ${expression}`) as () => Promise<unknown>)()
  await withDom([], () => assert.rejects(run(targetClickExpression({ control: 'dialog.tools' })), /not rendered now/))
  await withDom([fakeElement({ disabled: true })], () =>
    assert.rejects(run(targetClickExpression({ control: 'composer.send' })), /Element is disabled/))
  const rows = [
    fakeElement({ attributes: { 'data-ui-key': 'a' }, innerText: 'Alpha chat' }),
    fakeElement({ attributes: { 'data-ui-key': 'b' }, innerText: 'Beta chat' })
  ]
  await withDom(rows, () =>
    assert.rejects(run(targetClickExpression({ control: 'drawer.row' })), /matches 2 elements.*Items: a: Alpha chat \| b: Beta chat/))
  await withDom(rows, () =>
    assert.rejects(run(targetClickExpression({ control: 'drawer.row', match: 'gamma' })), /No visible drawer\.row matches "gamma"/))
})
