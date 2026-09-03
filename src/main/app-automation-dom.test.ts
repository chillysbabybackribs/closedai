import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appInspectionExpression,
  conditionProbeExpression,
  selectorClickExpression,
  selectorTypeExpression,
  selectorValueExpression
} from './app-automation-dom.ts'

test('app inspection is one bounded renderer expression with reusable refs and visible text', () => {
  const expression = appInspectionExpression('a123', 40)
  assert.match(expression, /function inspectFrame/)
  assert.match(expression, /"a123","app",40/)
  assert.match(expression, /visibleText/)
  assert.match(expression, /textTruncated/)
})

test('focused app inspection scopes and filters controls without collecting document text', () => {
  const expression = appInspectionExpression('a123', 20, {
    surface: 'side-drawer', query: 'history', includeText: false
  })
  assert.match(expression, /"surface":"side-drawer"/)
  assert.match(expression, /"query":"history"/)
  assert.match(expression, /const includeText = false/)
  assert.match(expression, /data-ui-surface/)
  assert.doesNotThrow(() => new Function(`return ${expression}`))
})

test('selector-only condition probes do not read the entire document text', () => {
  const expression = conditionProbeExpression({
    selector: '.ready', condition: 'visible', timeoutMs: 500
  })
  assert.match(expression, /const selector = "\.ready"/)
  assert.doesNotMatch(expression, /document\.body\.innerText/)
  assert.match(expression, /matches: matched\.map\(describe\)/)
})

test('selector action expressions are valid renderer JavaScript', () => {
  const expressions = [
    selectorClickExpression('.target'),
    selectorTypeExpression('input[aria-label="Search"]', true),
    selectorValueExpression('input[aria-label="Search"]')
  ]
  for (const expression of expressions) {
    assert.doesNotThrow(() => new Function(`return ${expression}`))
    assert.doesNotMatch(expression, /\sas\sHTMLElement/)
  }
})

test('selector clicks reject disabled controls before dispatch', async () => {
  const element = {
    isConnected: true,
    disabled: true,
    getAttribute: () => null,
    getClientRects: () => [{ width: 80, height: 30 }]
  }
  const originalDocument = globalThis.document
  const originalStyle = globalThis.getComputedStyle
  Object.assign(globalThis, {
    document: { querySelectorAll: () => [element] },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
  })
  try {
    const execute = new Function(`return ${selectorClickExpression('.disabled')}`) as () => Promise<unknown>
    await assert.rejects(execute(), /Element is disabled/)
  } finally {
    Object.assign(globalThis, { document: originalDocument, getComputedStyle: originalStyle })
  }
})
