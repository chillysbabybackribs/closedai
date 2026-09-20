import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverPapers, MAX_ABSTRACT, paperDigest, parsePapers } from './provider.js'

const now = '2026-09-20T12:00:00.000Z'
const since = '2026-06-22'
const row = { paperId: '2609.12345v2', title: 'Agent memory', abstract: 'Evidence retrieval', publicationDate: '2026-09-18T00:00:00.000Z' }

test('discovery normalizes versions, bounds abstracts, and rejects invalid or out-of-window records', () => {
  const papers = parsePapers([
    row, { ...row, paperId: '2609.12345v3', abstract: 'a'.repeat(7000) },
    { ...row, paperId: '../../private' }, { ...row, paperId: '2609.99999', publicationDate: '2027-01-01' },
    { ...row, paperId: '2501.11111', publicationDate: '2025-01-01' }, null
  ], 'Agent memory', since, now)
  assert.equal(papers.length, 1)
  assert.equal(papers[0]!.id, '2609.12345')
  assert.equal(papers[0]!.url, 'https://www.alphaxiv.org/abs/2609.12345')
  assert.equal(papers[0]!.abstract.length, MAX_ABSTRACT)
  assert.equal(papers[0]!.abstractTruncated, true)
  assert.equal(papers[0]!.sha256, paperDigest('Agent memory', papers[0]!.abstract))
  assert.throws(() => parsePapers({ results: [] }, 'Memory', since, now), /shape/)
  assert.deepEqual(parsePapers([], 'Memory', since, now), [])
})

test('public discovery uses only the configured topic, omits credentials, and disallows redirects', async () => {
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://api.alphaxiv.org')
    assert.equal(url.searchParams.get('q'), 'Agent memory & retrieval')
    assert.equal(url.searchParams.get('publishedAfter'), since)
    assert.equal(init?.credentials, 'omit')
    assert.equal(init?.redirect, 'error')
    return Response.json([row])
  }
  const papers = await discoverPapers(fakeFetch, 'Agent memory & retrieval', since, now, new AbortController().signal)
  assert.equal(papers.length, 1)
})

test('errors, oversized responses, and cancellation never become successful empty collections', async () => {
  const signal = new AbortController().signal
  await assert.rejects(discoverPapers(async () => new Response('', { status: 429 }), 'Memory', since, now, signal), /HTTP 429/)
  await assert.rejects(discoverPapers(async () => new Response('a'.repeat(524289)), 'Memory', since, now, signal), /512 KiB/)
  const controller = new AbortController()
  const pending = discoverPapers(() => new Promise(() => {}), 'Memory', since, now, controller.signal)
  controller.abort(new Error('User stopped'))
  await assert.rejects(pending, /User stopped/)
})
