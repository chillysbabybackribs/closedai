import assert from 'node:assert/strict'
import test from 'node:test'

import { appInspectionExpression, conditionProbeExpression } from './app-automation-dom.ts'

test('app inspection is one bounded renderer expression with reusable refs and visible text', () => {
  const expression = appInspectionExpression('a123', 40)
  assert.match(expression, /function inspectFrame/)
  assert.match(expression, /"a123","app",40/)
  assert.match(expression, /visibleText/)
  assert.match(expression, /textTruncated/)
})

test('selector-only condition probes do not read the entire document text', () => {
  const expression = conditionProbeExpression({
    selector: '.ready', condition: 'visible', timeoutMs: 500
  })
  assert.match(expression, /const selector = "\.ready"/)
  assert.doesNotMatch(expression, /document\.body\.innerText/)
  assert.match(expression, /matches: matched\.map\(describe\)/)
})
