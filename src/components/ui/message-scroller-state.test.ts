import assert from 'node:assert/strict'
import test from 'node:test'

import {
  anchorScrollLayout,
  followingAfterViewportSync,
  preservedScrollTop,
  resizeScrollAction,
  scrollEdges
} from './message-scroller-state.ts'

test('a new prompt gets enough trailing space to sit at the top of the viewport', () => {
  assert.deepEqual(anchorScrollLayout({
    anchorTop: 1_400,
    contentHeight: 1_600,
    previousItemPeek: 0,
    viewportHeight: 700
  }), {
    scrollTop: 1_400,
    spacerHeight: 500
  })
})

test('a prompt with a full response below it does not create trailing space', () => {
  assert.deepEqual(anchorScrollLayout({
    anchorTop: 1_400,
    contentHeight: 2_400,
    previousItemPeek: 0,
    viewportHeight: 700
  }), {
    scrollTop: 1_400,
    spacerHeight: 0
  })
})

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


const bottomFollowing = {
  prepending: false, newAnchor: false, anchorMode: false,
  anchored: false, following: true, autoScroll: true
}

test('streaming, delayed history, and late layout changes follow the real bottom', () => {
  assert.equal(resizeScrollAction(bottomFollowing), 'end')
  assert.equal(resizeScrollAction({ ...bottomFollowing, newAnchor: true }), 'end')
  assert.equal(resizeScrollAction({ ...bottomFollowing, anchored: true }), 'end')
})

test('a reader above the bottom stays put during streaming but a new prompt resumes following', () => {
  const reading = { ...bottomFollowing, following: false }
  assert.equal(resizeScrollAction(reading), 'none')
  assert.equal(resizeScrollAction({ ...reading, newAnchor: true }), 'end')
})

test('revealing older history preserves position even when the visible anchor changes', () => {
  assert.equal(resizeScrollAction({
    ...bottomFollowing, prepending: true, newAnchor: true
  }), 'preserve')
})

test('prompt anchoring is opt-in and does not leak into bottom-following mode', () => {
  assert.equal(resizeScrollAction({
    ...bottomFollowing, anchorMode: true, newAnchor: true
  }), 'anchor')
  assert.equal(resizeScrollAction({
    ...bottomFollowing, autoScroll: false, following: false, newAnchor: true
  }), 'none')
})
