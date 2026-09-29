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

test('exportNavigationStack returns null for a single restorable entry without page state', () => {
  assert.equal(exportNavigationStack([{ url: 'https://only.example/', title: 'Only' }], 0), null)
})

test('exportNavigationStack keeps a single page whose state holds its scroll offset', () => {
  assert.deepEqual(exportNavigationStack([{ url: 'https://only.example/', title: 'Only', pageState: 'scroll' }], 0), {
    entries: [{ url: 'https://only.example/', title: 'Only', pageState: 'scroll' }],
    index: 0
  })
  assert.deepEqual(normalizeNavigationStack({ entries: [{ url: 'https://only.example/', title: 'Only', pageState: 'scroll' }], index: 0 }), {
    entries: [{ url: 'https://only.example/', title: 'Only', pageState: 'scroll' }],
    index: 0
  })
})

test('exportNavigationStack keeps the active page when earlier entries are dropped', () => {
  // A tool-opened tab starts on about:blank; going back from B must restore A, not B.
  const stack = exportNavigationStack([
    { url: 'about:blank', title: '' },
    { url: 'https://a.example/', title: 'A' },
    { url: 'https://b.example/', title: 'B' }
  ], 1)
  assert.equal(stack?.entries[stack.index].url, 'https://a.example/')
  const long = Array.from({ length: 60 }, (_unused, index) => ({ url: `https://p${index}.example/`, title: String(index) }))
  const trimmed = exportNavigationStack(long, 30)
  assert.equal(trimmed?.entries[trimmed.index].url, 'https://p30.example/')
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
