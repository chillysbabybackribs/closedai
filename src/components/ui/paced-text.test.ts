import assert from 'node:assert/strict'
import test from 'node:test'

import { extendsShownText, REVEAL_CATCH_UP_MS, revealStep } from './paced-text.ts'

test('a reveal always advances by at least one unit per tick', () => {
  assert.equal(revealStep('hello', 0, 0.0001), 1)
  assert.equal(revealStep('hello', 4, 1), 5)
})

test('a full catch-up window drains any backlog completely', () => {
  assert.equal(revealStep('x'.repeat(50_000), 0, REVEAL_CATCH_UP_MS), 50_000)
  assert.equal(revealStep('short', 0, REVEAL_CATCH_UP_MS * 3), 5)
})

test('progress per frame is proportional to the backlog, so bursts sweep instead of popping', () => {
  const text = 'x'.repeat(1_000)
  const frame = REVEAL_CATCH_UP_MS / 10
  const first = revealStep(text, 0, frame)
  assert.equal(first, 100)
  // The remaining backlog shrinks, and so does the next step: an exponential ease-out.
  const second = revealStep(text, first, frame)
  assert.equal(second, 190)
})

test('the boundary never splits a surrogate pair', () => {
  // '😀' is two UTF-16 units; a step landing between them must include both.
  const text = 'a😀b'
  const next = revealStep(text, 1, 0.0001)
  assert.equal(next, 3)
  assert.equal(text.slice(0, next), 'a😀')
})

test('a step past the end clamps to the text length', () => {
  assert.equal(revealStep('abc', 3, 16), 3)
  assert.equal(revealStep('abc', 7, 16), 3)
})

test('appended text extends the shown prefix; replaced text does not', () => {
  assert.equal(extendsShownText('hello', 'hello world', 5), true)
  assert.equal(extendsShownText('hello world', 'hello', 5), true)
  assert.equal(extendsShownText('draft answer', 'final answer', 5), false)
  // Only the displayed prefix has to survive: unseen text may be rewritten freely.
  assert.equal(extendsShownText('draft answer', 'draft reply', 6), true)
})
