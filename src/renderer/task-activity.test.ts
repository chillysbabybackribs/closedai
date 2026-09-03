import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { formatElapsedTime, TaskActivity } from './task-activity.tsx'

test('an active turn renders a fresh timer instead of a thinking label', () => {
  const html = renderToStaticMarkup(createElement(TaskActivity, { activeTurnId: 'turn-1' }))
  assert.match(html, />0:00</)
  assert.doesNotMatch(html, /Thinking/)
})

test('turn elapsed time starts at zero and uses minute-second notation', () => {
  assert.equal(formatElapsedTime(0), '0:00')
  assert.equal(formatElapsedTime(9), '0:09')
  assert.equal(formatElapsedTime(65), '1:05')
})

test('turn elapsed time adds an hours segment for long-running turns', () => {
  assert.equal(formatElapsedTime(3_661), '1:01:01')
})

test('turn elapsed time safely normalizes incomplete seconds', () => {
  assert.equal(formatElapsedTime(1.9), '0:01')
  assert.equal(formatElapsedTime(-5), '0:00')
})
