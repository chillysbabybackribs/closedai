import assert from 'node:assert/strict'
import test from 'node:test'
import { closedAiDeveloperInstructions } from './developer-instructions.ts'
import { resumeThreadParams, startThreadParams } from './thread-params.ts'
import { WORKSPACE_INDEX_ROOT } from '../tools/workspace/workspace-index.generated.ts'
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

test('the trusted capsule is small and contains only stable orientation', () => {
  const navigation = workspaceNavigationSection(WORKSPACE_INDEX_ROOT) ?? ''
  assert.ok(navigation.length < 700, `navigation capsule grew to ${navigation.length} chars`)
  assert.match(navigation, /renderer\/components -> shared <- preload <- main/)
  assert.match(navigation, /src\/shared\/api\.ts/)
  assert.match(navigation, /closedai_workspace\.inspect/)
  assert.doesNotMatch(navigation, /browser-service\.ts/)
})

test('mapped threads carry instructions plus navigation on start and resume', () => {
  const tools = new ToolRegistry([])
  const navigation = workspaceNavigationSection(WORKSPACE_INDEX_ROOT) ?? ''
  const expected = `${closedAiDeveloperInstructions()}\n\n${navigation}`
  assert.equal(startThreadParams(WORKSPACE_INDEX_ROOT, tools, 'model-a').developerInstructions, expected)
  assert.equal(resumeThreadParams('thread-a', WORKSPACE_INDEX_ROOT, tools).developerInstructions, expected)
})
