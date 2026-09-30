import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionFetchResult } from '../../browser-network/session-fetch.js'
import { ToolRegistry } from '../registry.js'
import { siteTools } from './index.js'
import {
  buildHints,
  parseLlmsTxt,
  parseRobots,
  parseSitemapLocs,
  rankSitemapEntries
} from './discover-probes.js'

function sessionHarness(responses: Record<string, Partial<SessionFetchResult> & { text?: string | null }>) {
  return siteTools(() => ({
    fetch: async (request) => {
      const key = Object.keys(responses).find((candidate) => request.url.includes(candidate) || request.url === candidate)
      const row = key ? responses[key]! : { status: 404, ok: false, text: null, byteLength: 0 }
      return {
        url: request.url,
        finalUrl: row.finalUrl ?? request.url,
        status: row.status ?? 404,
        ok: row.ok ?? false,
        redirected: false,
        headers: row.headers ?? {},
        contentType: row.contentType ?? null,
        text: row.text ?? null,
        base64: null,
        byteLength: row.byteLength ?? (row.text?.length ?? 0),
        truncated: false
      }
    },
    cookies: async () => ({ matched: 0, cookies: [] }),
    setCookie: async () => {
      throw new Error('not used')
    },
    removeCookie: async () => ({ removed: 0 })
  }))
}

test('parseRobots collects sitemap lines and agent rules', () => {
  const parsed = parseRobots(`User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml\n`)
  assert.deepEqual(parsed.sitemaps, ['https://example.com/sitemap.xml'])
  assert.equal(parsed.rules[0]?.disallow[0], '/private')
})

test('parseSitemapLocs reads urlset entries', () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://example.com/docs</loc><lastmod>2026-01-01</lastmod></url></urlset>`
  const parsed = parseSitemapLocs(xml, 10)
  assert.equal(parsed.locs.length, 1)
  assert.equal(parsed.locs[0]?.loc, 'https://example.com/docs')
})

test('rankSitemapEntries prefers focus tokens', () => {
  const ranked = rankSitemapEntries(
    [
      { loc: 'https://example.com/blog' },
      { loc: 'https://example.com/docs/api' }
    ],
    ['docs'],
    2
  )
  assert.equal(ranked[0]?.loc, 'https://example.com/docs/api')
})

test('parseLlmsTxt extracts markdown links', () => {
  const parsed = parseLlmsTxt('# Site\n\nSee [Docs](/docs).\n', 500)
  assert.match(parsed.excerpt, /Site/)
  assert.equal(parsed.links[0]?.href, '/docs')
})

test('buildHints mentions llms and openapi findings', () => {
  const hints = buildHints({
    llmsTxt: { foundUrl: 'https://a.test/llms.txt', links: [{ text: 'Docs', href: 'https://a.test/docs' }] },
    openapi: { foundUrl: 'https://a.test/openapi.json', pathCount: 3 }
  })
  assert.ok(hints.some((line) => line.includes('llms.txt')))
  assert.ok(hints.some((line) => line.includes('OpenAPI')))
})

test('site.discover bootstrap returns robots and sitemap card', async () => {
  const registry = new ToolRegistry([
    sessionHarness({
      '/robots.txt': {
        status: 200,
        ok: true,
        contentType: 'text/plain',
        text: 'Sitemap: https://example.com/sitemap.xml\n'
      },
      '/sitemap.xml': {
        status: 200,
        ok: true,
        contentType: 'application/xml',
        text: '<urlset><url><loc>https://example.com/docs</loc></url></urlset>'
      },
      'https://example.com/': {
        status: 200,
        ok: true,
        contentType: 'text/html',
        text: '<html><head><title>Example</title></head><body><nav><a href="/docs">Docs</a></nav></body></html>'
      }
    })
  ])
  const result = await registry.call(
    {
      namespace: 'site',
      tool: 'discover',
      arguments: { action: 'bootstrap', url: 'https://example.com/', channels: ['robots', 'sitemap', 'html'] }
    },
    { threadId: null, turnId: null, callId: 'c' }
  )
  assert.equal(result.isError, undefined)
  const text = result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
  const payload = JSON.parse(text) as { robots: { ok: boolean }; sitemap: { returned: number }; html: { ok: boolean } }
  assert.equal(payload.robots.ok, true)
  assert.equal(payload.sitemap.returned, 1)
  assert.equal(payload.html.ok, true)
})
