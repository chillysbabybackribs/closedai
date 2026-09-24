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
    agents: [repair, triage], initialAgentId: null, startEnabled: true,
    onSave: async () => repair, onRemove: async () => {}, onStart: async () => {}, onBack: () => {}, onDone: () => {}, ...overrides
  }
  return renderToStaticMarkup(createElement(AgentLibraryPanel, props))
}

test('a new draft opens blank under a back control, with Start off until there are instructions', () => {
  const html = render()
  assert.match(html, /data-ui="agents\.back"/)
  assert.match(html, /agent-screen-title[^>]*>New agent</)
  assert.match(html, /data-ui="agents\.name"[^>]*value=""/)
  assert.match(html, /data-ui="agents\.prompt"[^>]*><\/textarea>/)
  assert.doesNotMatch(html, /data-ui="agents\.delete"/)
  assert.match(html, /data-ui="agents\.start"[^>]*disabled=""/)
})

test('editing a saved agent loads its fields, titles the screen, and offers Delete', () => {
  const html = render({ initialAgentId: 'a2' })
  assert.match(html, /agent-screen-title[^>]*>Triage bot</)
  assert.match(html, /data-ui="agents\.name"[^>]*value="Triage bot"/)
  assert.match(html, /data-ui="agents\.max-cycles"[^>]*value="4"/)
  assert.match(html, /Sort issues\./)
  assert.match(html, /data-ui="agents\.delete"/)
  assert.doesNotMatch(html, /data-ui="agents\.start"[^>]*disabled=""/)
})

test('a held draft wins over the saved text and reads as unsaved', () => {
  const html = render({ initialAgentId: 'a2', initialDraft: { name: 'Triage bot', prompt: 'Sort issues by age.', maxCycles: '4' } })
  assert.match(html, /Sort issues by age\./)
  assert.match(html, /Unsaved changes/)
})

test('start is off while the launching pane cannot run', () => {
  assert.match(render({ initialAgentId: 'a1', startEnabled: false }), /data-ui="agents\.start"[^>]*disabled=""/)
})

test('describeAgentUse counts runs and dates the last one', () => {
  const now = 10 * HOUR
  assert.equal(describeAgentUse({ runCount: 0, lastRunAt: null }, now), 'Never run')
  assert.equal(describeAgentUse({ runCount: 1, lastRunAt: now - 30_000 }, now), 'Ran once · last moments ago')
  assert.equal(describeAgentUse({ runCount: 12, lastRunAt: now - 3 * 24 * HOUR }, now), 'Ran 12 times · last 3 d ago')
})
