import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { closedAiDeveloperInstructions } from './developer-instructions.ts'
import { resumeThreadParams, startThreadParams } from './thread-params.ts'
import { workspaceMapSection } from './workspace-map.ts'
import { WORKSPACE_MAP_ROOT } from './workspace-map.generated.ts'
import { ToolRegistry } from '../tools/registry.ts'

test('the map is withheld from a workspace it does not describe', () => {
  assert.equal(workspaceMapSection('/some/other/checkout'), null)
})

test('the map is served for the checkout it describes, however the path is spelled', () => {
  const map = workspaceMapSection(WORKSPACE_MAP_ROOT)
  assert.ok(map)
  assert.equal(workspaceMapSection(`${WORKSPACE_MAP_ROOT}/`), map)
  assert.equal(workspaceMapSection(`${WORKSPACE_MAP_ROOT}/src/..`), map)
})

test('the map states the layer rule and the contract hub', () => {
  const map = workspaceMapSection(WORKSPACE_MAP_ROOT) ?? ''
  assert.match(map, /renderer and components -> shared <- preload <- main/)
  assert.match(map, /src\/shared\/api\.ts/)
})

test('the map derives the renderer-to-main IPC ownership table', () => {
  const map = workspaceMapSection(WORKSPACE_MAP_ROOT) ?? ''
  assert.match(map, /chat:\*\s+->\s+main\/chat-ipc\.ts/)
  assert.match(map, /browserDownloads:\*\s+->\s+main\/browser-downloads-ipc\.ts/)
  assert.match(map, /window:\*\s+->\s+main\/index\.ts/)
})

/** A map that names a file which does not exist costs more than no map, so verify every path. */
test('every file the map names exists on disk', () => {
  const map = workspaceMapSection(WORKSPACE_MAP_ROOT) ?? ''
  let directory: string | null = null
  let checked = 0
  for (const line of map.split('\n')) {
    if (/^src[^\s]*\/$/.test(line)) {
      directory = line.slice(0, -1)
      assert.ok(existsSync(join(WORKSPACE_MAP_ROOT, directory)), `missing directory ${directory}`)
      continue
    }
    const entry = line.match(/^ {2}([\w.-]+\.tsx?)( \*)?$/)
    if (!entry || !directory) continue
    const relative = `${directory}/${entry[1]}`
    assert.ok(existsSync(join(WORKSPACE_MAP_ROOT, relative)), `missing file ${relative}`)
    checked += 1
  }
  assert.ok(checked > 100, `expected the map to name most source files, saw ${checked}`)
})

test('a mapped thread carries instructions plus the map, on start and on resume', () => {
  const tools = new ToolRegistry([])
  const map = workspaceMapSection(WORKSPACE_MAP_ROOT) ?? ''
  const expected = `${closedAiDeveloperInstructions()}\n\n${map}`
  assert.equal(startThreadParams(WORKSPACE_MAP_ROOT, tools, 'model-a').developerInstructions, expected)
  assert.equal(resumeThreadParams('thread-a', WORKSPACE_MAP_ROOT, tools).developerInstructions, expected)
})

test('the map stays a small fraction of a capped exec result', () => {
  const map = workspaceMapSection(WORKSPACE_MAP_ROOT) ?? ''
  assert.ok(map.length < 8_000, `map grew to ${map.length} chars; tune collapseAbove`)
})
