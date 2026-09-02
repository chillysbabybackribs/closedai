import assert from 'node:assert/strict'
import test from 'node:test'

import {
  followingAfterViewportSync,
  preservedScrollTop,
  scrollEdges
} from './message-scroller-state.ts'

test('short content has no scrollable edge', () => {
  assert.deepEqual(scrollEdges({ clientHeight: 500, scrollHeight: 300, scrollTop: 0 }, 24), {
    start: false,
    end: false
  })
})

test('the middle of a long transcript exposes both directions', () => {
  assert.deepEqual(scrollEdges({ clientHeight: 500, scrollHeight: 2_000, scrollTop: 700 }, 24), {
    start: true,
    end: true
  })
})

test('the edge threshold absorbs fractional layout and zoom drift', () => {
  assert.deepEqual(scrollEdges({ clientHeight: 500, scrollHeight: 2_000, scrollTop: 1_490 }, 24), {
    start: true,
    end: false
  })
})

test('rubber-band positions are clamped before calculating edges', () => {
  assert.deepEqual(scrollEdges({ clientHeight: 500, scrollHeight: 2_000, scrollTop: -30 }, 24), {
    start: false,
    end: true
  })
})

test('prepending rows preserves the reader position by the exact height delta', () => {
  assert.equal(preservedScrollTop({ scrollHeight: 2_000, scrollTop: 500 }, 2_750), 1_250)
})

test('layout growth cannot silently break bottom following before ResizeObserver corrects it', () => {
  assert.equal(followingAfterViewportSync(true, true, { start: true, end: true }), true)
})

test('explicitly escaped readers stay put until they return to the bottom', () => {
  assert.equal(followingAfterViewportSync(false, true, { start: true, end: true }), false)
  assert.equal(followingAfterViewportSync(false, true, { start: true, end: false }), true)
})
