import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import type { BrowserToolHost } from './host.js'
import { browserTools } from './index.js'
import type { SessionToolHost } from './network-host.js'

const page = {} as BrowserToolHost
const cookie = { name: 'sid', value: 'abc', domain: '.a.test', path: '/', secure: true, httpOnly: true, session: false, expiresAt: null, sameSite: 'lax' }

function harness(text: string | null = '{"items":[1,2]}', contentType = 'application/json') {
  const calls: unknown[] = []
  const host: SessionToolHost = {
    fetch: async (request) => (calls.push(['fetch', request]), {
      url: request.url, finalUrl: request.url, status: 200, ok: true, redirected: false, headers: { 'content-type': contentType },
      contentType, text, base64: text === null ? 'AQID' : null, byteLength: 3, truncated: false
    }),
    cookies: async (filter) => (calls.push(['cookies', filter]), { matched: 1, cookies: [cookie] }),
    setCookie: async (input) => (calls.push(['setCookie', input]), { ...cookie, name: input.name, value: input.value }),
    removeCookie: async (input) => (calls.push(['removeCookie', input]), { removed: 1 })
  }
  const registry = new ToolRegistry([browserTools(() => page, undefined, () => host)])
  const call = (args: Record<string, unknown>) =>
    registry.call({ namespace: 'embedded_browser', tool: 'session', arguments: args }, { threadId: null, turnId: null, callId: 'c' })
  return { calls, call, registry }
}

function payload(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text ?? '{}' : '{}') as Record<string, unknown>
}

test('the session tool registers with fetch and cookie actions', () => {
  const { registry } = harness()
  assert.deepEqual(registry.names(), ['embedded_browser.page', 'embedded_browser.script', 'embedded_browser.session'])
  assert.deepEqual(registry.namespaces[0].tools[2].actions?.map((action) => action.name), ['fetch', 'cookies', 'set_cookie', 'remove_cookie'])
})

test('fetch forwards the request, parses JSON, and keeps response headers', async () => {
  const { calls, call } = harness()
  const result = await call({ action: 'fetch', url: 'https://api.test/x', method: 'POST', headers: { accept: 'application/json' }, body: '{}', redirect: 'manual' })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls[0], ['fetch', { url: 'https://api.test/x', method: 'POST', headers: { accept: 'application/json' }, body: '{}', redirect: 'manual' }])
  const body = payload(result)
  assert.equal(body.isJson, true)
  assert.deepEqual(body.json, { items: [1, 2] })
  assert.deepEqual(body.headers, { 'content-type': 'application/json' })
  assert.equal('text' in body, false)
})

test('fetch returns prose as text and binary as base64', async () => {
  const prose = payload(await harness('hello', 'text/plain').call({ action: 'fetch', url: 'https://a.test/' }))
  assert.equal(prose.text, 'hello')
  assert.equal(prose.isJson, false)
  const binary = payload(await harness(null, 'image/png').call({ action: 'fetch', url: 'https://a.test/i.png' }))
  assert.equal(binary.binary, true)
  assert.equal(binary.base64, 'AQID')
})

test('a large JSON response is projected rather than truncated into a bare note', async () => {
  const document = JSON.stringify({ data: { items: [{ name: 'One', owner: { login: 'a' }, extra: 'x'.repeat(500) }, { name: 'Two', owner: { login: 'b' }, extra: 'y'.repeat(500) }] } })
  const { call } = harness(document)
  const projected = payload(await call({ action: 'fetch', url: 'https://api.test/x', json_path: 'data.items', fields: ['name', 'owner.login'], limit: 1, max_chars: 400 }))
  assert.deepEqual(projected.json, [{ name: 'One', 'owner.login': 'a' }])
  assert.deepEqual([projected.matched, projected.returned, projected.limited], [2, 1, true])
  const missing = await call({ action: 'fetch', url: 'https://api.test/x', json_path: 'data.absent' })
  assert.equal(missing.isError, true)
})

test('cookie actions map their arguments', async () => {
  const { calls, call } = harness()
  await call({ action: 'cookies', domain: 'a.test', max_cookies: 5 })
  assert.deepEqual(calls[0], ['cookies', { url: undefined, domain: 'a.test', name: undefined, limit: 5 }])
  const set = await call({ action: 'set_cookie', name: 'flag', value: '1', domain: 'a.test', secure: true, http_only: false, expires_at: 2_000_000_000, same_site: 'lax' })
  assert.equal(set.isError, undefined)
  assert.deepEqual(calls[1], ['setCookie', { name: 'flag', value: '1', url: undefined, domain: 'a.test', path: undefined, secure: true, httpOnly: false, expiresAt: 2_000_000_000, sameSite: 'lax' }])
  assert.deepEqual(payload(await call({ action: 'remove_cookie', name: 'sid', url: 'https://a.test/' })), { removed: 1 })
  assert.equal((await call({ action: 'set_cookie', name: 'x' })).isError, true)
})
