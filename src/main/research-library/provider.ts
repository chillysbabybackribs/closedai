import { createHash } from 'node:crypto'
import type { LibraryPaper } from '../../shared/research-library.js'
import { abortable } from '../tools/search/request-budget.js'

const MAX_BODY_BYTES = 512 * 1024
export const MAX_ABSTRACT = 6000
const PAPER_ID = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/

export function paperId(value: unknown): string | null {
  return typeof value === 'string' && PAPER_ID.test(value) ? value.replace(/v\d+$/, '') : null
}

export function paperDigest(title: string, abstract: string): string {
  return createHash('sha256').update(JSON.stringify({ title, abstract })).digest('hex')
}

/** Fixed public endpoint: no account, credentials, page execution, or model invocation. */
export async function discoverPapers(
  fetchPublic: typeof fetch, topic: string, since: string, now: string, signal: AbortSignal
): Promise<LibraryPaper[]> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
  const url = new URL('https://api.alphaxiv.org/search/v2/paper/discover/embedding')
  url.searchParams.set('q', topic)
  url.searchParams.set('prioritize', 'recency')
  url.searchParams.set('publishedAfter', since)
  const response = await abortable(fetchPublic(url.href, {
    signal: deadline, credentials: 'omit', redirect: 'error',
    headers: { Accept: 'application/json' }
  }), deadline)
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`alphaXiv returned HTTP ${response.status}; try refreshing later.`)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('alphaXiv returned an empty response')
  const decoder = new TextDecoder()
  let raw = ''
  let bytes = 0
  try {
    while (true) {
      const chunk = await abortable(reader.read(), deadline)
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_BODY_BYTES) throw new Error('alphaXiv response exceeded the 512 KiB limit')
      raw += decoder.decode(chunk.value, { stream: true })
    }
    raw += decoder.decode()
    deadline.throwIfAborted()
    return parsePapers(JSON.parse(raw), topic, since, now)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function parsePapers(value: unknown, topic: string, since: string, now: string): LibraryPaper[] {
  if (!Array.isArray(value)) throw new Error('alphaXiv returned an unexpected response shape')
  const papers = new Map<string, LibraryPaper>()
  for (const row of value.slice(0, 100)) {
    if (!row || typeof row !== 'object') continue
    const id = paperId(row.paperId)
    const date = typeof row.publicationDate === 'string' ? Date.parse(row.publicationDate) : NaN
    if (!id || typeof row.title !== 'string' || !row.title.trim() || !Number.isFinite(date)) continue
    if (date < Date.parse(since) || date > Date.parse(now)) continue
    const title = row.title.trim().slice(0, 500)
    const rawAbstract = typeof row.abstract === 'string' ? row.abstract.trim() : ''
    const abstract = rawAbstract.slice(0, MAX_ABSTRACT)
    papers.set(id, {
      id, title, abstract, abstractTruncated: rawAbstract.length > MAX_ABSTRACT,
      publishedAt: new Date(date).toISOString(), url: `https://www.alphaxiv.org/abs/${id}`,
      topics: [topic], retrievedAt: now, sha256: paperDigest(title, abstract)
    })
    if (papers.size >= 20) break
  }
  if (value.length && !papers.size) throw new Error('alphaXiv returned no valid papers inside the requested publication window')
  return [...papers.values()]
}
