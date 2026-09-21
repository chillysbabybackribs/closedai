import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
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

const TOKEN = /[A-Za-z0-9_-]{32}/
const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } }
})

type RequestOptions = { method?: string; headers?: Record<string, string>; body?: string; setHost?: boolean }

/** Raw node:http so the test can send the Host and Origin values fetch refuses to set. */
function request(url: string, options: RequestOptions = {}): Promise<number> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: target.hostname,
      port: target.port,
      path: target.pathname,
      method: options.method ?? 'GET',
      setHost: options.setHost ?? true,
      headers: options.headers ?? {}
    }, (res) => {
      resolve(res.statusCode ?? 0)
      res.destroy()
    })
    req.once('error', reject)
    req.end(options.body)
  })
}

function initialize(url: string, headers: Record<string, string> = {}): Promise<number> {
  return request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: INITIALIZE
  })
}

test('endpoints are empty until the bridge is listening', () => {
  const bridge = new McpHttpBridge(registry, { label: 'test', keyedByPath: true })
  assert.deepEqual(bridge.endpoints('k'), [])
  assert.equal(bridge.listening, false)
})

test('a path-keyed bridge addresses each caller separately behind one token', async () => {
  const bridge = new McpHttpBridge(registry, { label: 'test', keyedByPath: true })
  await bridge.start()
  try {
    const [first] = bridge.endpoints('pane-a')
    const [second] = bridge.endpoints('pane b/c')
    assert.match(first!.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp\/[A-Za-z0-9_-]{32}\/pane-a\/embedded_browser$/)
    // A key with characters that would otherwise split the route is escaped, not truncated.
    assert.match(second!.url, /\/mcp\/[A-Za-z0-9_-]{32}\/pane%20b%2Fc\/embedded_browser$/)
    assert.equal(TOKEN.exec(first!.url)?.[0], TOKEN.exec(second!.url)?.[0], 'one token per bridge instance')
    assert.deepEqual(bridge.endpoints('pane-a').map((entry) => entry.namespace), ['embedded_browser', 'closedai_ui'])
  } finally {
    await bridge.stop()
  }
})

test('a meta-keyed bridge serves one shared endpoint set that the token admits', async () => {
  const bridge = new McpHttpBridge(registry, { label: 'test', keyedByPath: false })
  await bridge.start()
  try {
    const [first] = bridge.endpoints('ignored')
    assert.match(first!.url, /\/mcp\/[A-Za-z0-9_-]{32}\/embedded_browser$/)
    assert.equal(await initialize(first!.url), 200)
  } finally {
    await bridge.stop()
  }
})

test('the token admits a client; a wrong or missing token is not a route', async () => {
  const bridge = new McpHttpBridge(registry, { label: 'test', keyedByPath: true })
  await bridge.start()
  try {
    const url = bridge.endpoints('k')[0]!.url
    const base = url.replace(/\/mcp\/.*$/, '')
    const token = TOKEN.exec(url)![0]
    assert.equal(await initialize(url), 200)
    // A known route with no MCP session cannot be served by a GET.
    assert.equal(await request(url), 400)
    assert.equal(await initialize(url.replace(token, 'x'.repeat(32))), 404)
    assert.equal(await initialize(url.replace(token, token.slice(1))), 404)
    // The pre-token shapes are no longer routes, keyed or not.
    assert.equal(await initialize(`${base}/mcp/k/embedded_browser`), 404)
    assert.equal(await initialize(`${base}/mcp/embedded_browser`), 404)
    assert.equal(await request(`${base}/nope`), 404)
  } finally {
    await bridge.stop()
  }
})

test('only a same-machine client naming this listener is served', async () => {
  const bridge = new McpHttpBridge(registry, { label: 'test', keyedByPath: false })
  await bridge.start()
  try {
    const url = bridge.endpoints()[0]!.url
    const port = new URL(url).port
    assert.equal(await initialize(url, { host: `localhost:${port}` }), 200)
    assert.equal(await initialize(url, { host: 'evil.example:80' }), 403)
    assert.equal(await initialize(url, { host: `127.0.0.1:${Number(port) + 1}` }), 403)
    assert.equal(await initialize(url, { host: '127.0.0.1' }), 403)
    // Node's server refuses an HTTP/1.1 request that carries no Host at all before the bridge sees it.
    assert.equal(await request(url, { setHost: false }), 400)
    // A browser page always sends Origin on a cross-site POST; the CLIs never send one.
    assert.equal(await initialize(url, { origin: `http://127.0.0.1:${port}` }), 403)
    assert.equal(await initialize(url, { origin: 'null' }), 403)
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
