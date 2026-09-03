import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { formatElapsedTime, TaskActivity, TurnActivityIndicator } from './task-activity.tsx'

test('an active turn renders a Codex-style working timer instead of a thinking label', () => {
  const html = renderToStaticMarkup(createElement(TurnActivityIndicator, { activeTurnId: 'turn-1' }))
  assert.match(html, />Working for 0s</)
  assert.doesNotMatch(html, /Thinking/)
})

test('turn elapsed time uses seconds without a leading minute segment', () => {
  assert.equal(formatElapsedTime(0), '0s')
  assert.equal(formatElapsedTime(9), '9s')
  assert.equal(formatElapsedTime(28), '28s')
  assert.equal(formatElapsedTime(65), '1m 5s')
})

test('turn elapsed time adds an hours segment for long-running turns', () => {
  assert.equal(formatElapsedTime(3_661), '1h 1m 1s')
})

test('turn elapsed time safely normalizes incomplete seconds', () => {
  assert.equal(formatElapsedTime(1.9), '1s')
  assert.equal(formatElapsedTime(-5), '0s')
})

test('the working timer is a bare indicator so the composer rail can host it', () => {
  const running = renderToStaticMarkup(createElement(TurnActivityIndicator, { activeTurnId: 't' }))
  assert.match(running, /composer-strip-activity/)
  assert.doesNotMatch(running, /task-activity-strip/)
  assert.equal(renderToStaticMarkup(createElement(TurnActivityIndicator, { activeTurnId: null })), '')
})

test('the activity strip renders only when a background control needs it', () => {
  const control = createElement('button', null, 'Background tasks')
  const withControl = renderToStaticMarkup(createElement(TaskActivity, null, control))
  assert.equal((withControl.match(/task-activity-strip/g) ?? []).length, 1)
  assert.match(withControl, /Background tasks/)
  assert.doesNotMatch(withControl, /task-generation-loader/)
  assert.equal(renderToStaticMarkup(createElement(TaskActivity, null)), '')
})

test('the timer reserves room for a four-digit clock so its position holds', () => {
  const html = renderToStaticMarkup(createElement(TurnActivityIndicator, { activeTurnId: 't' }))
  assert.match(html, /task-generation-reserve[^>]*>Working for 88m 88s</)
})
