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

test('the checkout gets the map and a clause that settles it against re-verification', () => {
  const text = antigravityAgentInstructions(WORKSPACE_INDEX_ROOT)
  const map = text.indexOf('Repository map (generated from this checkout')
  const trust = text.indexOf('The repository map above was read from the checkout')
  assert.ok(map > 0 && trust > map, 'trust clause follows the map')
  assert.ok(text.includes('do not re-verify it with grep_search, find_by_name, list_dir, view_file'))
})
