import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCodexModelContextWindows } from './codex-model-context.ts'

test('Codex model context prefers native capacities over lower cache defaults', () => {
  const windows = parseCodexModelContextWindows({
    models: [
      { slug: 'gpt-6-astra', context_window: 272_000, max_context_window: 872_000 },
      { slug: 'gpt-5.6-sol', context_window: 272_000, max_context_window: 872_000 },
      { slug: 'gpt-5.5', context_window: 272_000, max_context_window: 272_000 },
      { slug: 'gpt-5.4-mini', context_window: 272_000, max_context_window: 272_000 },
      { slug: 'gpt-5.3-codex-spark', context_window: 128_000, max_context_window: 128_000 },
      { slug: 'unknown', context_window: 128_000, max_context_window: 256_000 },
      { id: 'legacy', context_window: 200_000, max_context_window: null },
      { slug: 'broken', max_context_window: -1 },
      null
    ]
  })
  assert.deepEqual([...windows], [
    ['gpt-6-astra', 1_050_000],
    ['gpt-5.6-sol', 1_050_000],
    ['gpt-5.5', 1_050_000],
    ['gpt-5.4-mini', 400_000],
    ['gpt-5.3-codex-spark', 400_000],
    ['unknown', 256_000],
    ['legacy', 200_000]
  ])
})

test('malformed caches yield no model overrides', () => {
  assert.deepEqual([...parseCodexModelContextWindows(null)], [])
  assert.deepEqual([...parseCodexModelContextWindows({ models: 'nope' })], [])
})
