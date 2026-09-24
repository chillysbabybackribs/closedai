import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describeAgentUse, type SavedAgent } from '../../shared/agent-library.js'
import { AgentLibraryPanel, type AgentLibraryPanelProps } from './agent-library-panel.tsx'

const HOUR = 3_600_000
const repair: SavedAgent = { id: 'a1', name: 'Repair agent', prompt: 'Fix things.', maxCycles: null, createdAt: 1, updatedAt: 1, lastRunAt: 5 * HOUR, runCount: 3 }
const triage: SavedAgent = { id: 'a2', name: 'Triage bot', prompt: 'Sort issues.', maxCycles: 4, createdAt: 1, updatedAt: 1, lastRunAt: null, runCount: 0 }

function render(overrides: Partial<AgentLibraryPanelProps> = {}): string {
  const props: AgentLibraryPanelProps = {
    agents: [repair, triage], now: 7 * HOUR, startEnabled: true,
    onSave: async () => repair, onRemove: async () => {}, onStart: async () => {}, ...overrides
  }
  return renderToStaticMarkup(createElement(AgentLibraryPanel, props))
}

test('the library lists saved agents in a table and opens on a blank draft', () => {
  const html = render()
  assert.match(html, /data-ui="agents\.item" data-ui-key="a1"/)
  assert.match(html, /Ran 3 times · last 2 h ago/)
  assert.match(html, /Never run · 4 max/)
  assert.match(html, /data-ui="agents\.name"[^>]*value=""/)
  assert.match(html, /data-ui="agents\.prompt"[^>]*><\/textarea>/)
  assert.doesNotMatch(html, /aria-selected="true"/)
  assert.doesNotMatch(html, /data-ui="agents\.delete"/)
  assert.match(html, /data-ui="agents\.start"[^>]*disabled=""/, 'Start waits for instructions on a new draft')
})

test('an empty library shows a new draft with Start off until there are instructions', () => {
  const html = render({ agents: [] })
  assert.match(html, /Saved agents appear here/)
  assert.match(html, /data-ui="agents\.name"[^>]*value=""/)
  assert.doesNotMatch(html, /data-ui="agents\.delete"/)
  assert.match(html, /data-ui="agents\.start"[^>]*disabled=""/)
})

test('start is off while the launching pane cannot run', () => {
  const html = render({ startEnabled: false })
  assert.match(html, /data-ui="agents\.start"[^>]*disabled=""/)
})

test('describeAgentUse counts runs and dates the last one', () => {
  const now = 10 * HOUR
  assert.equal(describeAgentUse({ runCount: 0, lastRunAt: null }, now), 'Never run')
  assert.equal(describeAgentUse({ runCount: 1, lastRunAt: now - 30_000 }, now), 'Ran once · last moments ago')
  assert.equal(describeAgentUse({ runCount: 12, lastRunAt: now - 3 * 24 * HOUR }, now), 'Ran 12 times · last 3 d ago')
})
