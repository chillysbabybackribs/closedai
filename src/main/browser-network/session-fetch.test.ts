import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeBytes, fetchWithSession, replayableHeaders, SESSION_BODY_CEILING } from './session-fetch.js'

function response(body: string | Buffer, init: { status?: number; headers?: Record<string, string>; url?: string; redirected?: boolean } = {}): Response {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body
  return {
    url: init.url ?? 'https://api.test/final',
    status: init.status ?? 200,
    ok: (init.status ?? 200) < 400,
    redirected: init.redirected ?? false,
    headers: new Headers(init.headers ?? {}),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  } as unknown as Response
}

test('fetchWithSession sends with credentials and returns headers, text, and redirect facts', async () => {
  const seen: unknown[] = []
  const result = await fetchWithSession(async (url, init) => {
    seen.push([url, init])
    return response('{"ok":true}', { headers: { 'content-type': 'application/json', 'x-rate': '9' }, redirected: true })
  }, { url: 'https://api.test/x', method: 'POST', headers: { accept: 'application/json' }, body: '{}' })
  assert.deepEqual(seen[0], ['https://api.test/x', { method: 'POST', headers: { accept: 'application/json' }, credentials: 'include', redirect: 'follow', body: '{}' }])
  assert.equal(result.text, '{"ok":true}')
  assert.equal(result.headers['x-rate'], '9')
  assert.equal(result.contentType, 'application/json')
  assert.equal(result.finalUrl, 'https://api.test/final')
  assert.equal(result.redirected, true)
  assert.equal(result.base64, null)
})

test('binary bodies come back as base64 with their length, and oversized ones are flagged', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0xff, 0xfe])
  const binary = await fetchWithSession(async () => response(png, { headers: { 'content-type': 'image/png' } }), { url: 'https://a.test/i.png', method: 'GET' })
  assert.equal(binary.text, null)
  assert.equal(binary.base64, png.toString('base64'))
  assert.equal(binary.byteLength, 8)
  const huge = await fetchWithSession(async () => response(Buffer.alloc(SESSION_BODY_CEILING + 5, 0x61)), { url: 'https://a.test/big', method: 'GET' })
  assert.equal(huge.truncated, true)
  assert.equal(huge.text?.length, SESSION_BODY_CEILING)
})

test('decodeBytes keeps UTF-8 text and rejects NUL-bearing payloads', () => {
  assert.equal(decodeBytes(Buffer.from('héllo')).text, 'héllo')
  assert.equal(decodeBytes(Buffer.from([0x61, 0x00, 0x62])).text, null)
  assert.equal(decodeBytes(Buffer.alloc(0)).text, '')
})

test('replayableHeaders drops hop-by-hop and session-managed headers', () => {
  assert.deepEqual(replayableHeaders({ cookie: 'a=b', 'Content-Length': '3', accept: '*/*', ':authority': 'x', 'x-csrf': 't' }), { accept: '*/*', 'x-csrf': 't' })
  assert.deepEqual(replayableHeaders(null), {})
})
