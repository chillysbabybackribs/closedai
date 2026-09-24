import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DockTile } from './agent-run-overview-model.ts'
import { AgentRunCard } from './agent-run-card.tsx'

const tile: DockTile = { chatId: 'c1', name: 'Daily brief', state: 'running', running: true, cycleLabel: 'Cycle 2 of 4',
  detail: 'Reading lethain.com', attentionKey: null,
  brief: [{ kind: 'progress', text: 'Cycle 2 of 4 has been working 40s.' }, { kind: 'cost', text: 'Each cycle re-sends 61.0k tokens.' }, { kind: 'error', text: '1 error across 3 steps.' }] }
const noop = async (): Promise<void> => {}
const render = (patch: Partial<DockTile>): string => renderToStaticMarkup(createElement(AgentRunCard, {
  tile: { ...tile, ...patch }, onOpenChat: () => {}, onPause: noop, onResume: noop, onStop: noop }))

test('a running tile shows its name, cycle, activity, Pause, Stop, and Open as a chat', () => {
  const html = render({})
  assert.match(html, /Daily brief/)
  assert.match(html, /Cycle 2 of 4/)
  assert.match(html, /Reading lethain\.com/)
  assert.match(html, /data-ui="agents\.pause"/)
  assert.match(html, /data-ui="agents\.stop"/)
  assert.match(html, /data-ui="agents\.open-chat" data-ui-key="c1"/)
  assert.doesNotMatch(html, /data-ui="agents\.resume"/)
  assert.match(html, /agent-run-table-brief/)
  assert.match(html, /data-kind="progress"[^>]*>Cycle 2 of 4 has been working 40s\./)
  assert.match(html, /data-kind="error">1 error across 3 steps\./)
})

test('paused tiles resume, finished tiles dismiss, approvals send the user to review', () => {
  assert.match(render({ state: 'paused', running: false }), /data-ui="agents\.resume"/)
  const finished = render({ state: 'finished', running: false })
  assert.doesNotMatch(finished, /data-ui="agents\.resume"/)
  assert.match(finished, />Dismiss</)
  const approval = render({ state: 'approval' })
  assert.match(approval, /data-ui="agents\.review"/)
  assert.doesNotMatch(approval, /data-ui="agents\.pause"/)
})
