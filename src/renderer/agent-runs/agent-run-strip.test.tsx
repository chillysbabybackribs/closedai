import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentRun } from '../../shared/agent-runs.js'
import { AgentRunStrip } from './agent-run-strip.tsx'

const base: AgentRun = { chatId: 'c1', prompt: 'Go.', status: 'running', cycle: 3, maxCycles: 10, startedAt: 1, updatedAt: 1,
  lastTurnEndedAt: null, reason: null, failures: 0, threadId: null, agentId: null, name: null }
const noop = async (): Promise<void> => {}

test('a running strip offers Pause and Stop with the cycle count', () => {
  const html = renderToStaticMarkup(createElement(AgentRunStrip, { run: base, onPause: noop, onResume: noop, onStop: noop }))
  assert.match(html, /data-state="running"/)
  assert.match(html, /Agent running/)
  assert.match(html, /cycle 3 of 10/)
  assert.match(html, /data-ui="chat\.agent-pause"/)
  assert.match(html, /data-ui="chat\.agent-stop"/)
  assert.doesNotMatch(html, /data-ui="chat\.agent-resume"/)
})

test('a paused strip shows the reason and offers Resume', () => {
  const run: AgentRun = { ...base, status: 'paused', reason: 'App relaunched', maxCycles: null }
  const html = renderToStaticMarkup(createElement(AgentRunStrip, { run, onPause: noop, onResume: noop, onStop: noop }))
  assert.match(html, /data-state="paused"/)
  assert.match(html, /Agent paused/)
  assert.match(html, /App relaunched/)
  assert.match(html, /data-ui="chat\.agent-resume"/)
  assert.doesNotMatch(html, /of \d+/)
})

test('a run started from the library is named on the strip', () => {
  const run: AgentRun = { ...base, agentId: 'saved-1', name: 'Repair agent' }
  const html = renderToStaticMarkup(createElement(AgentRunStrip, { run, onPause: noop, onResume: noop, onStop: noop }))
  assert.match(html, /Repair agent running/)
  assert.doesNotMatch(html, /Agent running/)
})
