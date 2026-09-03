import assert from 'node:assert/strict'
import test from 'node:test'

import { compactAppInspectionElements } from './app-automation-inspection.ts'
import type { LocalElement } from './cdp/page-control/runtime.ts'

function element(ref: string, text = 'History'): LocalElement {
  return {
    ref,
    frameId: 'app',
    tag: 'button',
    role: 'button',
    name: text,
    text,
    bounds: { x: 10.123, y: 20.456, width: 100.789, height: 30.111 },
    center: { x: 60, y: 35 },
    quad: [10, 20, 110, 20, 110, 50, 10, 50],
    quadSource: 'client_rect',
    visible: true,
    hitTestable: true,
    disabled: false
  }
}

test('app inspection projection preserves action evidence and drops geometry duplication', () => {
  const result = compactAppInspectionElements([element('a1:app:e1')])
  assert.deepEqual(result, {
    elements: [{
      ref: 'a1:app:e1',
      tag: 'button',
      role: 'button',
      name: 'History',
      state: { disabled: false },
      bounds: { x: 10.1, y: 20.5, width: 100.8, height: 30.1 },
      hitTestable: true
    }],
    omitted: 0
  })
})

test('app inspection projection stops before its result budget is exceeded', () => {
  const source = [element('a1'), element('a2', 'Downloads')]
  const result = compactAppInspectionElements(source, 190)
  assert.equal(result.elements.length, 1)
  assert.equal(result.omitted, 1)
  assert.ok(JSON.stringify(result.elements).length <= 190)
})
