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
  assert.match(text, /native file search and editing tools are available/)
})
