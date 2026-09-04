import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCodexModelContextWindows } from './codex-model-context.ts'

test('Codex model context uses each catalog maximum with a current-window fallback', () => {
  const windows = parseCodexModelContextWindows({
    models: [
      { slug: 'sol', context_window: 272_000, max_context_window: 872_000 },
      { slug: 'spark', context_window: 128_000 },
      { id: 'legacy', context_window: 200_000, max_context_window: null },
      { slug: 'broken', max_context_window: -1 },
      null
    ]
  })
  assert.deepEqual([...windows], [['sol', 872_000], ['spark', 128_000], ['legacy', 200_000]])
})

test('malformed caches yield no model overrides', () => {
  assert.deepEqual([...parseCodexModelContextWindows(null)], [])
  assert.deepEqual([...parseCodexModelContextWindows({ models: 'nope' })], [])
})
