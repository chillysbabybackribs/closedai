import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DockTile } from './agent-run-overview-model.ts'
import { AgentRunOverview, type AgentRunOverviewProps } from './agent-run-overview.tsx'

const tile: DockTile = { chatId: 'c1', name: 'Daily brief', state: 'paused', running: false, cycleLabel: 'Cycle 2', timeLabel: null, detail: 'Paused by you', attentionKey: null, brief: [] }
const noop = async (): Promise<void> => {}
const render = (tiles: DockTile[]): string => renderToStaticMarkup(createElement(AgentRunOverview, {
  tiles, onOpenChat: () => {}, onNewAgent: () => {}, onPause: noop, onResume: noop, onStop: noop } satisfies AgentRunOverviewProps))

test('runs render as table rows', () => {
  const html = render([tile])
  assert.match(html, /data-ui="agents\.run" data-ui-key="c1"/)
  assert.match(html, /Paused · Cycle 2/)
  assert.doesNotMatch(html, /No runs yet/)
})

test('no runs shows an empty state that offers New agent', () => {
  const html = render([])
  assert.match(html, /No runs yet/)
  assert.match(html, /data-ui="agents\.new"/)
  assert.doesNotMatch(html, /<table/)
})
