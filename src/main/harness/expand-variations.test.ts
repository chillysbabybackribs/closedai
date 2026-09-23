import assert from 'node:assert/strict'
import test from 'node:test'
import { expandTaskVariations } from './expand-variations.js'
import type { HarnessSimulationTask } from './types.js'

const base: HarnessSimulationTask = {
  id: 'matrix',
  tool: 'embedded_browser.page',
  replay: [{
    namespace: 'embedded_browser',
    tool: 'page',
    arguments: { action: 'read_page', pdf_page: 1 }
  }],
  oracle: {},
  variations: { pdf_page: [1, 2, 3] }
}

test('expandTaskVariations builds a Cartesian product', () => {
  const expanded = expandTaskVariations(base)
  assert.equal(expanded.length, 3)
  assert.deepEqual(expanded.map((e) => e.replay[0]!.arguments.pdf_page), [1, 2, 3])
  assert.ok(expanded.every((e) => e.variationKey.includes('pdf_page')))
})

test('expandTaskVariations keeps a single base run without variations', () => {
  const single = expandTaskVariations({ ...base, variations: undefined })
  assert.equal(single.length, 1)
  assert.equal(single[0]!.variationKey, 'base')
})
