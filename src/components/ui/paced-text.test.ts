import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { usePacedText } from './paced-text.js'

import {
  extendsShownText,
  nextArrivalInterval,
  REVEAL_MAX_LAG_MS,
  REVEAL_MIN_LAG_MS,
  revealStep,
  revealTargetLagMs
} from './paced-text.ts'

const FRAME_MS = 1000 / 60

/** Reveal a stream of `chunk` units every `gapMs`, returning units painted per frame. */
function paintedPerFrame(chunk: number, gapMs: number, frames: number): number[] {
  let received = 0
  let elapsed = 0
  let nextArrival = 0
  let lastArrival = 0
  let interval = REVEAL_MIN_LAG_MS
  let state = { rate: 0, shown: 0 }
  const painted: number[] = []
  for (let frame = 0; frame < frames; frame += 1) {
    elapsed += FRAME_MS
    let grew = false
    while (elapsed >= nextArrival) {
      received += chunk
      nextArrival += gapMs
      grew = true
    }
    if (grew) {
      if (lastArrival > 0) interval = nextArrivalInterval(interval, elapsed - lastArrival)
      lastArrival = elapsed
    }
    const before = state.shown
    state = revealStep('x'.repeat(received), state, FRAME_MS, revealTargetLagMs(interval))
    painted.push(state.shown - before)
  }
  return painted
}

test('a reveal always advances by at least one unit per tick', () => {
  assert.equal(revealStep('hello', { rate: 0, shown: 0 }, 0.0001).shown, 1)
  assert.equal(revealStep('hello', { rate: 0, shown: 4 }, 1).shown, 5)
})

test('a backlog older than the maximum lag drains whatever the rate has adapted to', () => {
  assert.equal(revealStep('x'.repeat(50_000), { rate: 0, shown: 0 }, REVEAL_MAX_LAG_MS).shown, 50_000)
  assert.equal(revealStep('short', { rate: 0, shown: 0 }, REVEAL_MAX_LAG_MS * 3).shown, 5)
})

test('a burst with nothing behind it sweeps in without a leading dump', () => {
  const text = 'x'.repeat(1_000)
  // The old proportional step spent a tenth of the backlog on the first frame and then crawled.
  const first = revealStep(text, { rate: 0, shown: 0 }, FRAME_MS)
  assert.ok(first.shown > 0 && first.shown < text.length / 20, `dumped ${first.shown} units at once`)
  let state = first
  let frames = 1
  while (state.shown < text.length && frames < 1_000) {
    state = revealStep(text, state, FRAME_MS)
    frames += 1
  }
  // It is still a sweep, not a wait: the whole burst lands close behind the maximum lag.
  assert.ok(frames * FRAME_MS < REVEAL_MAX_LAG_MS * 1.5, `took ${Math.round(frames * FRAME_MS)}ms`)
})

test('a steady stream paints at a steady rate, whatever size its chunks are', () => {
  for (const [chunk, gap] of [[12, 25], [30, 60], [60, 120], [200, 400]]) {
    const steady = paintedPerFrame(chunk, gap, 240).slice(80)
    const fastest = Math.max(...steady)
    const slowest = Math.min(...steady)
    assert.ok(slowest > 0, `chunk ${chunk}/${gap}ms stalled between chunks`)
    assert.ok(fastest / slowest < 1.75, `chunk ${chunk}/${gap}ms surged ${fastest}/${slowest} per frame`)
  }
})

test('the target lag follows the arrival cadence between the two bounds', () => {
  assert.equal(revealTargetLagMs(20), REVEAL_MIN_LAG_MS)
  assert.equal(revealTargetLagMs(400), 400)
  assert.equal(revealTargetLagMs(5_000), REVEAL_MAX_LAG_MS)
  // A gap longer than the cap cannot drag the tracked cadence past it.
  assert.ok(nextArrivalInterval(REVEAL_MIN_LAG_MS, 60_000) <= REVEAL_MAX_LAG_MS)
  // Widening and narrowing gaps both move the estimate toward the newest one.
  assert.ok(nextArrivalInterval(200, 400) > 200)
  assert.ok(nextArrivalInterval(400, 200) < 400)
})

test('the boundary never splits a surrogate pair', () => {
  // '😀' is two UTF-16 units; a step landing between them must include both.
  const text = 'a😀b'
  const next = revealStep(text, { rate: 0, shown: 1 }, 0.0001)
  assert.equal(next.shown, 3)
  assert.equal(text.slice(0, next.shown), 'a😀')
})

test('a step past the end clamps to the text length', () => {
  assert.equal(revealStep('abc', { rate: 1, shown: 3 }, 16).shown, 3)
  assert.equal(revealStep('abc', { rate: 1, shown: 7 }, 16).shown, 3)
})

test('appended text extends the shown prefix; replaced text does not', () => {
  assert.equal(extendsShownText('hello', 'hello world', 5), true)
  assert.equal(extendsShownText('hello world', 'hello', 5), true)
  assert.equal(extendsShownText('draft answer', 'final answer', 5), false)
  // Only the displayed prefix has to survive: unseen text may be rewritten freely.
  assert.equal(extendsShownText('draft answer', 'draft reply', 6), true)
})


test('instant streaming renders all text on the first render while pacing stays opt-in', () => {
  const View = ({ instant }: { instant: boolean }) => createElement('span', null, usePacedText('Immediate answer', false, instant))
  assert.equal(renderToStaticMarkup(createElement(View, { instant: true })), '<span>Immediate answer</span>')
  assert.equal(renderToStaticMarkup(createElement(View, { instant: false })), '<span></span>')
})
