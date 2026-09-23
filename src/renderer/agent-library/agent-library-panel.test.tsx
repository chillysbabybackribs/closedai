import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SavedAgent } from '../../shared/agent-library.js'
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

test('the library lists every saved agent with its use and loads the first one into the editor', () => {
  const html = render()
  assert.match(html, /data-ui="agents\.item" data-ui-key="a1"/)
  assert.match(html, /aria-selected="true"[^>]*data-ui-key="a1"/)
  assert.match(html, /3 runs · last 2 h ago/)
  assert.match(html, /Never run · 4 cycles/)
  assert.match(html, /data-ui="agents\.name"[^>]*value="Repair agent"/)
  assert.match(html, /data-ui="agents\.prompt"[^>]*>Fix things\.<\/textarea>/)
  assert.match(html, /data-ui="agents\.delete"/)
  assert.match(html, /data-ui="agents\.save"[^>]*disabled=""/, 'an unchanged entry has nothing to save')
  assert.doesNotMatch(html, /data-ui="agents\.start"[^>]*disabled=""/)
})

test('an empty library shows a new draft with Start off until there are instructions', () => {
  const html = render({ agents: [] })
  assert.match(html, /Nothing saved yet/)
  assert.match(html, /data-ui="agents\.name"[^>]*value=""/)
  assert.doesNotMatch(html, /data-ui="agents\.delete"/)
  assert.match(html, /data-ui="agents\.start"[^>]*disabled=""/)
})

test('start is off while the launching pane cannot run', () => {
  const html = render({ startEnabled: false })
  assert.match(html, /data-ui="agents\.start"[^>]*disabled=""/)
})
