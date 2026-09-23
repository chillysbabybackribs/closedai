import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describeAgentUse, type SavedAgent } from '../../shared/agent-library.js'
import { AgentLibraryPanel, type AgentLibraryActions } from './agent-library-dialog.tsx'

const HOUR = 3_600_000
const now = 10 * HOUR

function agent(id: string, name: string, extra: Partial<SavedAgent> = {}): SavedAgent {
  return { id, name, prompt: `${name} instructions`, maxCycles: null, createdAt: 1, updatedAt: 1, lastRunAt: null, runCount: 0, ...extra }
}

const library: AgentLibraryActions = {
  save: async () => { throw new Error('not in this test') },
  update: async () => null,
  remove: async () => {}
}
const noop = async (): Promise<void> => {}

test('the panel lists every agent, loads the first into the editor, and offers Start', () => {
  const agents = [agent('a', 'Repair agent', { runCount: 3, lastRunAt: now - 2 * HOUR }), agent('b', 'Daily brief')]
  const html = renderToStaticMarkup(createElement(AgentLibraryPanel, { agents, library, onStart: noop, now: () => now }))
  assert.match(html, /data-ui="composer\.agent-item" data-ui-key="a"/)
  assert.match(html, /data-ui="composer\.agent-item" data-ui-key="b"/)
  assert.match(html, /aria-selected="true"[^>]*data-ui-key="a"/)
  assert.match(html, /Ran 3 times · last 2 h ago/)
  assert.match(html, /Never run/)
  assert.match(html, /value="Repair agent"/, 'the name field holds the loaded agent')
  assert.match(html, />Repair agent instructions</, 'the prompt holds the loaded instructions')
  assert.match(html, /data-ui="composer\.agent-delete"/, 'a loaded saved agent can be deleted')
  assert.match(html, /data-ui="composer\.agent-save"[^>]*disabled=""/, 'nothing to save until the editor changes')
  assert.doesNotMatch(html, /data-ui="composer\.agent-start"[^>]*disabled/, 'Start is ready for the loaded agent')
})

test('an empty library opens on a blank editor with Start disabled and no Delete', () => {
  const html = renderToStaticMarkup(createElement(AgentLibraryPanel, { agents: [], library, onStart: noop, now: () => now }))
  assert.doesNotMatch(html, /composer\.agent-item/)
  assert.doesNotMatch(html, /composer\.agent-delete/)
  assert.match(html, /data-ui="composer\.agent-start"[^>]*disabled=""/)
  assert.match(html, /data-ui="composer\.agent-new"/)
})

test('describeAgentUse counts runs and dates the last one', () => {
  assert.equal(describeAgentUse({ runCount: 0, lastRunAt: null }, now), 'Never run')
  assert.equal(describeAgentUse({ runCount: 1, lastRunAt: now - 30_000 }, now), 'Ran once · last moments ago')
  assert.equal(describeAgentUse({ runCount: 12, lastRunAt: now - 3 * 24 * HOUR }, now), 'Ran 12 times · last 3 d ago')
})
