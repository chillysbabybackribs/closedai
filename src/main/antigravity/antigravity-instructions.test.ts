import assert from 'node:assert/strict'
import test from 'node:test'
import { WORKSPACE_INDEX_ROOT } from '../tools/workspace/workspace-index.generated.js'
import { antigravityAgentInstructions } from './antigravity-instructions.js'

test('file links are satisfied from known paths, anchored only by lines actually read', () => {
  const text = antigravityAgentInstructions('/w')
  assert.ok(text.includes('file:///w/<relative path>'))
  assert.ok(text.includes('Add a #L anchor only for a line you read this turn'))
  assert.ok(!text.includes('repository map above'), 'no map trust clause without a map')
})

test('the checkout uses native file tools without an injected map', () => {
  const text = antigravityAgentInstructions(WORKSPACE_INDEX_ROOT)
  assert.doesNotMatch(text, /Repository map \(generated|closedai_workspace|do not re-verify/)
  assert.match(text, /[Nn]ative file search and editing tools are available/)
})

test('the web belongs to the app tools, with no native web path offered', () => {
  const text = antigravityAgentInstructions('/w')
  assert.match(text, /mcp_search_query for discovery/)
  assert.match(text, /No native web or browser tool is granted/)
  assert.doesNotMatch(text, /Native browser tools use a separate browser/)
})

test('instructions include the shared objective enhancement without a forced procedural search', () => {
  const text = antigravityAgentInstructions('/w')
  assert.match(text, /Treat diagnoses and proposed methods as hypotheses/)
  assert.match(text, /Investigate a plausible better approach when it could materially improve the result/)
  assert.doesNotMatch(text, /run at least one search for alternatives to the named source/)
  assert.doesNotMatch(text, /"Sources checked" list/)
})
