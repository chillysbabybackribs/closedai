import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { TOOL_CATALOG } from '../tools/catalog.js'
import { coveredToolIds, harnessTasksDir, readWaivedTools } from './catalog-index.js'

const projectRoot = resolve(import.meta.dirname, '../../..')
const tasksDir = harnessTasksDir(projectRoot)

test('every catalog tool has simulation tasks or an explicit waiver', async () => {
  const covered = await coveredToolIds(tasksDir)
  const waived = await readWaivedTools(tasksDir)
  const missing: string[] = []
  for (const id of Object.keys(TOOL_CATALOG)) {
    if (covered.has(id)) continue
    if (waived.has(id)) continue
    missing.push(id)
  }
  assert.deepEqual(missing, [], `Add harness/tasks/<tool>.json or waived.json entry for: ${missing.join(', ')}`)
})

test('reads-web tools are mostly covered (task or waiver)', async () => {
  const readsWeb = Object.entries(TOOL_CATALOG).filter(([, e]) => e.group === 'reads-web').map(([id]) => id)
  const covered = await coveredToolIds(tasksDir)
  const waived = await readWaivedTools(tasksDir)
  let accounted = 0
  for (const id of readsWeb) {
    if (covered.has(id) || waived.has(id)) accounted++
  }
  assert.ok(accounted / readsWeb.length >= 0.8, `reads-web coverage ${accounted}/${readsWeb.length}`)
})

test('waived tools are valid catalog ids', async () => {
  const waived = await readWaivedTools(tasksDir)
  for (const id of waived.keys()) {
    assert.ok(TOOL_CATALOG[id], `unknown waived tool ${id}`)
  }
})
