import assert from 'node:assert/strict'
import test from 'node:test'
import { antigravityAgentInstructions } from '../antigravity/antigravity-instructions.ts'
import { claudeSystemPromptAppend } from '../claude/claude-instructions.ts'
import { closedAiDeveloperInstructions } from './developer-instructions.ts'
import { resumeThreadParams, startThreadParams } from './thread-params.ts'
import {
  WORKSPACE_AREAS,
  WORKSPACE_CONTROL_FAMILIES,
  WORKSPACE_FILES,
  WORKSPACE_INDEX_ROOT,
  WORKSPACE_IPC_FLOWS
} from '../tools/workspace/workspace-index.generated.ts'
import { currentWorkspaceIndex, workspaceMapSection } from './workspace-map.ts'
import { workspaceNavigationSection } from './workspace-navigation.ts'
import { ToolRegistry } from '../tools/registry.ts'

test('navigation is withheld from a workspace it does not describe', () => {
  assert.equal(workspaceNavigationSection('/some/other/checkout'), null)
})

test('navigation accepts equivalent spellings of the indexed checkout', () => {
  const navigation = workspaceNavigationSection(WORKSPACE_INDEX_ROOT)
  assert.ok(navigation)
  assert.equal(workspaceNavigationSection(`${WORKSPACE_INDEX_ROOT}/`), navigation)
  assert.equal(workspaceNavigationSection(`${WORKSPACE_INDEX_ROOT}/src/..`), navigation)
})

test('the hand-written prose stays small and carries no volatile file names', () => {
  const section = workspaceNavigationSection(WORKSPACE_INDEX_ROOT) ?? ''
  const prose = section.slice(0, section.indexOf(workspaceMapSection()))
  assert.ok(prose.length < 1200, `navigation prose grew to ${prose.length} chars`)
  assert.match(prose, /docs\/application\.md/)
  assert.match(prose, /docs\/model-context\.md/)
  assert.match(prose, /docs\/tools\.md/)
  assert.doesNotMatch(prose, /browser-service\.ts/)
})

test('the whole capsule stays inside its context budget', () => {
  const section = workspaceNavigationSection(WORKSPACE_INDEX_ROOT) ?? ''
  assert.ok(section.length < 5000, `orientation capsule grew to ${section.length} chars`)
})

test('the capsule points at the map first and demotes search to a fallback', () => {
  const section = workspaceNavigationSection(WORKSPACE_INDEX_ROOT) ?? ''
  assert.match(section, /Use the generated map for paths/)
  assert.match(section, /closedai_workspace\.inspect find for unknown locations/)
  assert.match(section, /read for a known symbol\/range/)
  assert.match(section, /Supply known_hash only for source still in context/)
})

test('the map states where things are, derived rather than asserted', () => {
  const map = workspaceMapSection()
  // A control family names its rendering file: the composer rail question, answered with no call.
  assert.match(map, /composer\.\* -> [^\n]*src\/renderer\/project-menu\.tsx/)
  // A directory's prefix is the rule that makes a path derivable without a lookup.
  assert.match(map, /src\/main\/claude \(\d+; claude-\* \d+\)/)
  assert.match(map, /chat -> src\/main\/chat-ipc\.ts/)
  // A list that reads as complete but is not gets acted on as complete; say which are which.
  assert.match(map, /exhaustive for non-test source/)
  assert.match(map, /dominant naming rules, not complete listings/)
})

test('the map is rendered from the checkout, not from the copy this build compiled', () => {
  const index = currentWorkspaceIndex()
  // The fallback carries identical data, so only the source distinguishes a real read from a
  // silent fallback — and a fallback is what leaves a long-running app describing a stale tree.
  assert.equal(index.source, 'checkout')
  assert.deepEqual(index.files, WORKSPACE_FILES)
  assert.deepEqual(index.areas, WORKSPACE_AREAS)
  assert.deepEqual(index.families, WORKSPACE_CONTROL_FAMILIES)
  assert.deepEqual(index.flows, WORKSPACE_IPC_FLOWS)
})

test('the map asks to be trusted without naming a command to audit it with', () => {
  // A named command is an invitation: one model spent six calls re-running the gate the
  // sentence cited instead of reading the answer already in front of it.
  assert.doesNotMatch(workspaceMapSection(), /npm run|map:check|check gate/)
})

test('every file the map names is really in the checkout', () => {
  const map = workspaceMapSection()
  const indexed = new Set<string>(WORKSPACE_FILES)
  const named = [...map.matchAll(/src\/[\w./-]+\.(?:tsx?|css)/g)].map(([file]) => file)
  assert.ok(named.length > 20, 'the map named too few files to be a useful check')
  for (const file of named) assert.ok(indexed.has(file), `${file} is named by the map but not indexed`)
})

test('all three provider lanes receive the navigation playbook in the indexed checkout', () => {
  const navigation = workspaceNavigationSection(WORKSPACE_INDEX_ROOT) ?? ''
  const lanes = [
    String(startThreadParams(WORKSPACE_INDEX_ROOT, new ToolRegistry([])).developerInstructions),
    claudeSystemPromptAppend(WORKSPACE_INDEX_ROOT),
    antigravityAgentInstructions(WORKSPACE_INDEX_ROOT)
  ]
  for (const lane of lanes) {
    assert.ok(lane.includes(navigation), 'a provider lane dropped the navigation capsule')
    assert.match(lane, /closedai_workspace\.inspect find/)
  }
})

test('mapped threads carry instructions plus navigation on start and resume', () => {
  const tools = new ToolRegistry([])
  const navigation = workspaceNavigationSection(WORKSPACE_INDEX_ROOT) ?? ''
  const expected = `${closedAiDeveloperInstructions(WORKSPACE_INDEX_ROOT)}\n\n${navigation}`
  assert.equal(startThreadParams(WORKSPACE_INDEX_ROOT, tools, { model: 'model-a', effort: null }).developerInstructions, expected)
  assert.equal(resumeThreadParams('thread-a', WORKSPACE_INDEX_ROOT, tools).developerInstructions, expected)
})
