import assert from 'node:assert/strict'
import test from 'node:test'
import { McpHttpBridge } from './mcp-http-bridge.ts'
import type { ToolRegistry } from './registry.ts'

const registry = {
  enabledNamespaces: () => [
    { name: 'embedded_browser', description: 'browser', tools: [] },
    { name: 'closedai_ui', description: 'ui', tools: [] }
  ],
  call: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
} as unknown as ToolRegistry

async function get(url: string): Promise<number> {
  const response = await fetch(url, { method: 'GET' })
  return response.status
}

test('endpoints are empty until the bridge is listening', () => {
  const bridge = new McpHttpBridge(registry, { label: 'test', keyedByPath: true })
  assert.deepEqual(bridge.endpoints('k'), [])
  assert.equal(bridge.listening, false)
})

test('a path-keyed bridge addresses each caller separately', async () => {
  const bridge = new McpHttpBridge(registry, { label: 'test', keyedByPath: true })
  await bridge.start()
  try {
    const [first] = bridge.endpoints('pane-a')
    const [second] = bridge.endpoints('pane b/c')
    assert.match(first!.url, /\/mcp\/pane-a\/embedded_browser$/)
    // A key with characters that would otherwise split the route is escaped, not truncated.
    assert.match(second!.url, /\/mcp\/pane%20b%2Fc\/embedded_browser$/)
    assert.deepEqual(bridge.endpoints('pane-a').map((entry) => entry.namespace), ['embedded_browser', 'closedai_ui'])
  } finally {
    await bridge.stop()
  }
})

test('a meta-keyed bridge serves one shared endpoint set', async () => {
  const bridge = new McpHttpBridge(registry, { label: 'test', keyedByPath: false })
  await bridge.start()
  try {
    const [first] = bridge.endpoints('ignored')
    assert.match(first!.url, /\/mcp\/embedded_browser$/)
  } finally {
    await bridge.stop()
  }
})

test('a route the bridge does not serve is refused, and a known one needs a POST', async () => {
  const bridge = new McpHttpBridge(registry, { label: 'test', keyedByPath: true })
  await bridge.start()
  try {
    const base = bridge.endpoints('k')[0]!.url.replace(/\/mcp\/.*$/, '')
    assert.equal(await get(`${base}/nope`), 404)
    // The unkeyed shape is not a route on a path-keyed bridge.
    assert.equal(await get(`${base}/mcp/embedded_browser`), 404)
    // A known route with no MCP session cannot be served by a GET.
    assert.equal(await get(`${base}/mcp/k/embedded_browser`), 400)
  } finally {
    await bridge.stop()
  }
})

test('an unclaimed call id is null, and unbinding forgets a caller', () => {
  const bridge = new McpHttpBridge(registry, { label: 'test', keyedByPath: true })
  bridge.bind('pane-a', { paneId: 'p', threadId: 't', turnId: 'turn' })
  assert.equal(bridge.takeCallId('pane-a', 'closedai_ui', 'capture'), null)
  assert.equal(bridge.takeCallId(null, 'closedai_ui', 'capture'), null)
  bridge.unbind('pane-a')
  assert.equal(bridge.takeCallId('pane-a', 'closedai_ui', 'capture'), null)
})

test('stopping a bridge that never listened is harmless', async () => {
  await new McpHttpBridge(registry, { label: 'test', keyedByPath: false }).stop()
})
