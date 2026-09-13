import assert from 'node:assert/strict'
import test from 'node:test'
import {
  exportNavigationStack,
  normalizeNavigationStack
} from './browser-navigation-stack.js'

test('exportNavigationStack keeps multi-entry stacks with the active index clamped', () => {
  const stack = exportNavigationStack([
    { url: 'https://a.example/', title: 'A' },
    { url: 'https://b.example/', title: 'B' },
    { url: 'about:blank', title: 'Blank' }
  ], 9)
  assert.deepEqual(stack, {
    entries: [
      { url: 'https://a.example/', title: 'A' },
      { url: 'https://b.example/', title: 'B' }
    ],
    index: 1
  })
})

test('exportNavigationStack returns null for a single restorable entry', () => {
  assert.equal(exportNavigationStack([{ url: 'https://only.example/', title: 'Only' }], 0), null)
})

test('normalizeNavigationStack rejects malformed stacks and keeps valid page state', () => {
  assert.equal(normalizeNavigationStack(null), null)
  assert.deepEqual(
    normalizeNavigationStack({
      entries: [
        { url: 'https://a.example/', title: 'A', pageState: 'abc' },
        { url: 'https://b.example/', title: 'B' }
      ],
      index: 0
    }),
    {
      entries: [
        { url: 'https://a.example/', title: 'A', pageState: 'abc' },
        { url: 'https://b.example/', title: 'B' }
      ],
      index: 0
    }
  )
})
