import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describeAgentUse, type SavedAgent } from '../../shared/agent-library.js'
import { EMPTY_NOTES, draftOf } from './agent-draft.ts'
import { AgentLibraryPanel, type AgentLibraryPanelProps } from './agent-library-panel.tsx'
import { AGENT_SUGGESTIONS } from './agent-suggestions.ts'

const HOUR = 3_600_000
const base = { description: '', maxMinutes: null, autonomous: true, createdAt: 1, updatedAt: 1 }
const repair: SavedAgent = { ...base, id: 'a1', name: 'Repair agent', prompt: 'Fix things.', maxCycles: null, lastRunAt: 5 * HOUR, runCount: 3 }
const triage: SavedAgent = { ...base, id: 'a2', name: 'Triage bot', description: 'sort new issues by area', prompt: 'Sort issues.', maxCycles: 4,
  maxMinutes: 120, autonomous: false, lastRunAt: null, runCount: 0 }
const ideas = AGENT_SUGGESTIONS.slice(0, 4)

function render(overrides: Partial<AgentLibraryPanelProps> = {}): string {
  const props: AgentLibraryPanelProps = {
    agents: [repair, triage], initialAgentId: null, startEnabled: true, launchPaneId: 'pane-1', initialSuggestions: ideas,
    onSave: async () => repair, onRemove: async () => {}, onStart: async () => {}, onBack: () => {}, onDone: () => {}, ...overrides
  }
  return renderToStaticMarkup(createElement(AgentLibraryPanel, props))
}

test('a new draft starts from an empty description with ideas under it; Optimize and Start wait for text', () => {
  const html = render()
  assert.match(html, /data-ui="agents\.back"/)
  assert.match(html, /agent-screen-title[^>]*>New agent</)
  assert.match(html, /data-ui="agents\.name"[^>]*value=""/)
  assert.match(html, /data-ui="agents\.description"[^>]*><\/textarea>/)
  assert.equal(html.match(/data-ui="agents\.suggestion"/g)?.length, 4)
  assert.match(html, new RegExp(`data-ui-key="${ideas[0]!.id}"`))
  assert.match(html, /data-ui="agents\.suggestions-shuffle"/)
  assert.match(html, /data-ui="agents\.optimize"[^>]*disabled=""/)
  assert.match(html, /data-ui="agents\.prompt"[^>]*><\/textarea>/)
  assert.doesNotMatch(html, /data-ui="agents\.delete"/)
  assert.match(html, /data-ui="agents\.start"[^>]*disabled=""/)
})

test('a new draft defaults to today\'s behavior: no limits and autonomous', () => {
  const html = render()
  assert.match(html, /data-ui="agents\.max-cycles"[^>]*value=""/)
  assert.match(html, /data-ui="agents\.time-limit"[^>]*aria-checked="false"|aria-checked="false"[^>]*data-ui="agents\.time-limit"/)
  assert.doesNotMatch(html, /data-ui="agents\.time-amount"/)
  assert.match(html, /data-ui="agents\.autonomy"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-ui="agents\.autonomy"/)
  assert.match(html, /The next cycle is sent as soon as a turn ends/)
})

test('editing a saved agent loads its description, instructions, limits and autonomy, and offers Delete', () => {
  const html = render({ initialAgentId: 'a2' })
  assert.match(html, /agent-screen-title[^>]*>Triage bot</)
  assert.match(html, /data-ui="agents\.name"[^>]*value="Triage bot"/)
  assert.match(html, /data-ui="agents\.description"[^>]*>sort new issues by area<\/textarea>/)
  assert.doesNotMatch(html, /data-ui="agents\.suggestion"/, 'ideas give way to a written description')
  assert.match(html, /data-ui="agents\.max-cycles"[^>]*value="4"/)
  assert.match(html, /data-ui="agents\.time-amount"[^>]*value="2"/)
  assert.match(html, /data-state="on"[^>]*data-ui-key="hours"|data-ui-key="hours"[^>]*data-state="on"/)
  assert.match(html, /Supervised: pauses after every cycle until you resume it/)
  assert.match(html, /Sort issues\./)
  assert.match(html, /Optimize again/)
  assert.doesNotMatch(html, /data-ui="agents\.optimize"[^>]*disabled=""/)
  assert.match(html, /data-ui="agents\.delete"/)
  assert.doesNotMatch(html, /data-ui="agents\.start"[^>]*disabled=""/)
})

test('an agent saved before the builder still opens: instructions only, with ideas offered for a description', () => {
  const html = render({ initialAgentId: 'a1' })
  assert.match(html, /Fix things\./)
  assert.match(html, /data-ui="agents\.suggestion"/)
  assert.doesNotMatch(html, /data-ui="agents\.start"[^>]*disabled=""/, 'typing instructions directly still starts a run')
})

test('a held draft wins over the saved text, reads as unsaved, and keeps its assumptions and Undo', () => {
  const html = render({ initialAgentId: 'a2', initialDraft: {
    draft: { ...draftOf(triage), prompt: 'Sort issues by age.' },
    notes: { generated: 'Sort issues by age.', assumptions: ['Issues are read, never closed.'], replaced: 'Sort issues.' }
  } })
  assert.match(html, /Sort issues by age\./)
  assert.match(html, /Unsaved changes/)
  assert.match(html, /Issues are read, never closed\./)
  assert.match(html, /data-ui="agents\.optimize-undo"/)
  assert.doesNotMatch(render({ initialAgentId: 'a2', initialDraft: { draft: draftOf(triage), notes: EMPTY_NOTES } }), /agents\.optimize-undo|Unsaved changes/)
})

test('a time limit that is switched on but unreadable blocks Save and Start and says why', () => {
  const html = render({ initialAgentId: 'a2', initialDraft: { draft: { ...draftOf(triage), timeAmount: '0' }, notes: EMPTY_NOTES } })
  assert.match(html, /Enter a time limit of at least 1 minute, or switch it off/)
  assert.match(html, /data-ui="agents\.start"[^>]*disabled=""/)
  assert.match(html, /data-ui="agents\.save"[^>]*disabled=""/)
})

test('start and optimize are off while the launching pane cannot run', () => {
  const html = render({ initialAgentId: 'a2', startEnabled: false })
  assert.match(html, /data-ui="agents\.start"[^>]*disabled=""/)
  assert.match(html, /data-ui="agents\.optimize"[^>]*disabled=""/)
  assert.match(render({ initialAgentId: 'a2', launchPaneId: null }), /data-ui="agents\.optimize"[^>]*disabled=""/)
})

test('describeAgentUse counts runs and dates the last one', () => {
  const now = 10 * HOUR
  assert.equal(describeAgentUse({ runCount: 0, lastRunAt: null }, now), 'Never run')
  assert.equal(describeAgentUse({ runCount: 1, lastRunAt: now - 30_000 }, now), 'Ran once · last moments ago')
  assert.equal(describeAgentUse({ runCount: 12, lastRunAt: now - 3 * 24 * HOUR }, now), 'Ran 12 times · last 3 d ago')
})
