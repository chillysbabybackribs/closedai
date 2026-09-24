import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DockTile } from './agent-dock-model.ts'
import { AgentDockTile } from './agent-dock-tile.tsx'

const tile: DockTile = { chatId: 'c1', name: 'Daily brief', state: 'running', running: true, cycleLabel: 'Cycle 2 of 4',
  detail: 'Reading lethain.com', attentionKey: null }
const noop = async (): Promise<void> => {}
const render = (patch: Partial<DockTile>): string => renderToStaticMarkup(createElement(AgentDockTile, {
  tile: { ...tile, ...patch }, onOpenChat: () => {}, onPause: noop, onResume: noop, onStop: noop }))

test('a running tile shows its name, cycle, activity, Pause, Stop, and Open as a chat', () => {
  const html = render({})
  assert.match(html, /Daily brief/)
  assert.match(html, /Cycle 2 of 4/)
  assert.match(html, /Reading lethain\.com/)
  assert.match(html, /data-ui="dock\.pause"/)
  assert.match(html, /data-ui="dock\.stop"/)
  assert.match(html, /data-ui="dock\.open-chat" data-ui-key="c1"/)
  assert.doesNotMatch(html, /data-ui="dock\.resume"/)
})

test('paused tiles resume, finished tiles dismiss, approvals send the user to review', () => {
  assert.match(render({ state: 'paused', running: false }), /data-ui="dock\.resume"/)
  const finished = render({ state: 'finished', running: false })
  assert.doesNotMatch(finished, /data-ui="dock\.resume"/)
  assert.match(finished, />Dismiss</)
  const approval = render({ state: 'approval' })
  assert.match(approval, /data-ui="dock\.review"/)
  assert.doesNotMatch(approval, /data-ui="dock\.pause"/)
})
