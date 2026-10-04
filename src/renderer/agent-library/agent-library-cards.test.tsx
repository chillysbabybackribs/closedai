import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SavedAgent } from '../../shared/agent-library.js'
import type { DockTile } from '../agent-runs/agent-run-overview-model.ts'
import { AgentLibraryCards, liveTilesByAgent, orderAgents, runsLabel, type AgentLibraryCardsProps } from './agent-library-cards.tsx'

const HOUR = 3_600_000
const repair: SavedAgent = { id: 'a1', name: 'Repair agent', description: '', maxMinutes: null, autonomous: true, prompt: 'Fix things.', maxCycles: null, createdAt: 1, updatedAt: 1, lastRunAt: 5 * HOUR, runCount: 3 }
const triage: SavedAgent = { id: 'a2', name: 'Triage bot', description: '', maxMinutes: null, autonomous: true, prompt: 'Sort issues.', maxCycles: 4, createdAt: 1, updatedAt: 1, lastRunAt: null, runCount: 0 }
const docs: SavedAgent = { id: 'a3', name: 'Docs sweep', description: '', maxMinutes: null, autonomous: true, prompt: 'Fix one stale paragraph.', maxCycles: 10, createdAt: 1, updatedAt: 1, lastRunAt: null, runCount: 0 }
const running: DockTile = { chatId: 'c1', name: 'Triage bot', state: 'running', running: true, cycleLabel: 'Cycle 2 of 4', timeLabel: null, detail: 'Working', attentionKey: null, brief: [] }
const failed: DockTile = { chatId: 'c2', name: 'Docs sweep', state: 'failed', running: false, cycleLabel: 'Cycle 1 of 10', timeLabel: null, detail: 'Paused', attentionKey: 'c2:failed:1', brief: [] }

function render(overrides: Partial<AgentLibraryCardsProps> = {}): string {
  const props: AgentLibraryCardsProps = {
    agents: [repair, triage, docs], tiles: [], live: new Map(), now: 7 * HOUR, startEnabled: true,
    onNew: () => {}, onEdit: () => {}, onRuns: () => {}, onStart: async () => {}, ...overrides
  }
  return renderToStaticMarkup(createElement(AgentLibraryCards, props))
}

test('live runs map to their agent, most urgent first, and order the cards', () => {
  const live = liveTilesByAgent([{ chatId: 'c1', agentId: 'a2' }, { chatId: 'c2', agentId: 'a3' }, { chatId: 'c3', agentId: null }], [failed, running])
  assert.deepEqual([...live.keys()], ['a3', 'a2'])
  assert.deepEqual(orderAgents([repair, triage, docs], live).map((agent) => agent.id), ['a3', 'a2', 'a1'])
  assert.deepEqual(orderAgents([triage, docs, repair], new Map()).map((agent) => agent.id), ['a1', 'a3', 'a2'], 'used first, then never-run by name')
})

test('the library shows a card per agent with its use line, Edit and Start', () => {
  const html = render()
  assert.match(html, /data-ui="agents\.card" data-ui-key="a1"/)
  assert.match(html, /Ran 3 times · last 2 h ago/)
  assert.match(html, /Never run · 4 max/)
  assert.match(html, /data-ui="agents\.edit" data-ui-key="a2"/)
  assert.match(html, /data-ui="agents\.card-start" data-ui-key="a2"/)
  assert.match(html, /data-ui="agents\.runs"[^>]*>Runs</, 'a bare Runs label when nothing runs')
  assert.match(html, /data-ui="agents\.new"/)
  assert.doesNotMatch(html, /No saved agents/)
})

test('a live run replaces the use line and the Runs label carries the summary', () => {
  const live = liveTilesByAgent([{ chatId: 'c1', agentId: 'a2' }], [running])
  const html = render({ tiles: [running], live })
  assert.match(html, /data-ui-key="a2" data-live="running"/)
  assert.match(html, /Running · Cycle 2 of 4/)
  assert.equal(runsLabel([running]), 'Runs · 1 running')
  assert.match(html, /Runs · 1 running/)
})

test('start is off while the launching pane cannot run, and an empty library offers New agent', () => {
  assert.match(render({ startEnabled: false }), /data-ui="agents\.card-start" data-ui-key="a1"[^>]*disabled=""/)
  const empty = render({ agents: [] })
  assert.match(empty, /No saved agents/)
  assert.match(empty, /data-ui="agents\.new"/)
  assert.doesNotMatch(empty, /data-ui="agents\.card"/)
})

test('a card leads with the description when the agent has one, and its use line names the limits and supervision', () => {
  const described: SavedAgent = { ...docs, id: 'a4', name: 'Coverage', description: 'raise coverage in services/billing', prompt: 'You are the coverage agent.', maxMinutes: 90, autonomous: false }
  const html = render({ agents: [described, repair] })
  assert.match(html, /raise coverage in services\/billing/)
  assert.doesNotMatch(html, /You are the coverage agent\./)
  assert.match(html, /Never run · 10 max · 1 h 30 min · supervised/)
  assert.match(html, /Fix things\./, 'an agent without a description still shows its instructions')
  const timed: DockTile = { ...running, timeLabel: '42 min left' }
  assert.match(render({ agents: [triage], tiles: [timed], live: new Map([['a2', timed]]) }), /Running · Cycle 2 of 4 · 42 min left/)
})
