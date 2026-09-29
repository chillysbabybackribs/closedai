import assert from 'node:assert/strict'
import test from 'node:test'

import { appTools } from '../tools/app/index.ts'
import { createToolRegistry } from '../tools/index.ts'
import { searchTools } from '../tools/search/index.ts'
import { CursorToolBridge } from './cursor-mcp.ts'

function stubHost(): null {
  return null
}

test('CursorToolBridge.servers filters endpoints by namespace allowlist', async () => {
  const registry = createToolRegistry([
    appTools(stubHost, stubHost),
    searchTools()
  ])
  const bridge = new CursorToolBridge(registry)
  await bridge.start()
  const key = 'pane-key'
  const all = bridge.servers(key).map((server) => server.name).sort()
  assert.deepEqual(all, ['closedai_app', 'search'])
  const core = bridge.servers(key, { namespaces: ['closedai_app'] }).map((server) => server.name)
  assert.deepEqual(core, ['closedai_app'])
  await bridge.stop()
})
