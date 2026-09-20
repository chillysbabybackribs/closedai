import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import type { PdfCoverage, SourceDate, SourceRepresentation } from '../../../../shared/web-research.js'
import { abortable, RequestBudget } from '../request-budget.js'
import { mergeDates, metaDate } from './source-metadata.js'
import { boundedText, DEFAULT_SOURCE_BYTES, textLimit, validateCoverage, type SourceCoverage } from './coverage.js'
import type { PdfReader } from './pdf/reader.js'

// An HTML body with a script tag and almost no text is a client-rendered shell, not evidence.
const SHELL_TEXT_LIMIT = 200
const OMIT = new Set(['script', 'style', 'template', 'noscript', 'nav', 'footer', 'head'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'h1', 'h2', 'h3', 'h4', 'li', 'tr', 'br', 'pre'])

export type SourceDocument = {
  text: string; title: string; url: string; contentType: string; sha256: string; incomplete: boolean
  representation: SourceRepresentation
  /** HTML with a script tag and almost no static text: probably a client-rendered shell. */
  sparse?: boolean
  dates?: SourceDate[]
  pdf?: PdfCoverage
}
export type SourceReader = (url: string, runId: string, sourceId: string, signal: AbortSignal, coverage?: SourceCoverage) => Promise<SourceDocument>

/** The static read succeeded but found no content; only a rendered read can do better. */
export class SourceNeedsRendering extends Error {
  override readonly name = 'SourceNeedsRendering'
}

export function publicUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) {
    throw new Error('Research sources must be HTTP(S) URLs without embedded credentials, at most 2048 characters')
  }
  return url.href
}

/** Inert WHATWG parsing: no page script executes. https://github.com/inikulin/parse5 */
export function documentText(raw: string, contentType: string): { text: string; title: string; dates?: SourceDate[] } {
  if (!contentType.includes('html')) return { text: raw, title: '' }
  const document = parse(raw)
  let title = ''
  const dates: SourceDate[] = []
  let main: DefaultTreeAdapterMap['node'] | undefined
  const nodes = [document as DefaultTreeAdapterMap['node']]
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if ('tagName' in node) {
      if (node.tagName === 'meta' && dates.length < 12) {
        const date = metaDate(node.attrs)
        if (date) dates.push(date)
      }
      if (node.tagName === 'title') title = node.childNodes.filter((child) => 'value' in child).map((child) => 'value' in child ? child.value : '').join('')
      if (!main && ['main', 'article'].includes(node.tagName)) main = node
    }
    if ('childNodes' in node) nodes.push(...node.childNodes)
  }
  const pieces: string[] = []
  const stack = [main ?? document]
  while (stack.length) {
    const node = stack.pop()!
    if ('tagName' in node) {
      if (OMIT.has(node.tagName) || node.attrs.some((attr) => attr.name === 'hidden' || (attr.name === 'aria-hidden' && attr.value === 'true'))) continue
      if (BLOCK.has(node.tagName)) pieces.push('\n')
    }
    if ('value' in node) pieces.push(node.value)
    if ('childNodes' in node) stack.push(...[...node.childNodes].reverse())
  }
  return { title, text: pieces.join('').replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim(), dates: mergeDates(dates) }
}

/** Source files are confined to app-generated ids; callers never supply filesystem paths. */
export class SourceStore {
  private readonly budget = new RequestBudget(8, 2)

  constructor(readonly root: string, private readonly fetchPage: typeof fetch, private readonly readPdf?: PdfReader) {}

  async collect(url: string, runId: string, sourceId: string, signal: AbortSignal, coverage: SourceCoverage = {}): Promise<SourceDocument> {
    validateCoverage(coverage)
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
    return this.budget.run(new URL(url).origin, runId, deadline, async () => {
      // Chromium follows redirects itself; Electron's fetch rejects `manual` outright with
      // "Redirect was cancelled". The final URL is the response's when the transport reports it.
      const response = await abortable(this.fetchPage(publicUrl(url), { signal: deadline, credentials: 'omit', redirect: 'follow' }), deadline)
      const current = response.url ? publicUrl(response.url) : publicUrl(url)
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Source returned HTTP ${response.status}`)
      }
      const type = (response.headers.get('content-type') ?? '').toLowerCase().slice(0, 120)
      if (type && !/^text\/|application\/(?:pdf|octet-stream|json|[^;]+\+json|xhtml\+xml)(?:;|$)/.test(type)) {
        await response.body?.cancel()
        throw new Error(`Unsupported source type: ${type || 'missing content-type'}; use search.run expand with method exa for provider text, or open it in the browser`)
      }
      return this.archive(response, current, type, runId, sourceId, deadline, coverage)
    })
  }

  /** Keep text a hidden worker rendered, or a search provider extracted, under the same id scheme. */
  async retain(runId: string, sourceId: string, page: { url: string; title: string; text: string; truncated: boolean },
    representation: 'rendered_text' | 'provider_text' = 'rendered_text', coverage: SourceCoverage = {}): Promise<SourceDocument> {
    validateCoverage(coverage)
    const text = boundedText(page.text, textLimit(coverage))
    if (!text.trim()) throw new Error(representation === 'rendered_text' ? 'The rendered page has no readable text' : 'The provider returned no page text')
    const directory = join(this.root, runId)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, `${sourceId}.txt.tmp`), text)
    await rename(join(directory, `${sourceId}.txt.tmp`), join(directory, `${sourceId}.txt`))
    return {
      text, title: page.title, url: publicUrl(page.url), representation,
      contentType: representation === 'rendered_text' ? 'text/html' : 'text/plain',
      sha256: createHash('sha256').update(text).digest('hex'), incomplete: page.truncated || page.text.length > text.length
    }
  }

  async read(runId: string, sourceId: string): Promise<string> {
    return readFile(join(this.root, runId, `${sourceId}.txt`), 'utf8')
  }

  async remove(runId: string): Promise<void> {
    await rm(join(this.root, runId), { recursive: true, force: true })
  }

  /** Expansion is staged under a temporary id. Only an accepted read replaces the text atomically. */
  async replace(runId: string, sourceId: string, stagedId: string): Promise<void> {
    await rename(join(this.root, runId, `${stagedId}.txt`), join(this.root, runId, `${sourceId}.txt`))
  }

  async discard(runId: string, sourceId: string): Promise<void> {
    for (const suffix of ['txt', 'raw', 'txt.tmp', 'raw.tmp']) {
      await rm(join(this.root, runId, `${sourceId}.${suffix}`), { force: true })
    }
  }

  private async archive(response: Response, url: string, contentType: string, runId: string, sourceId: string, signal: AbortSignal, coverage: SourceCoverage): Promise<SourceDocument> {
    const maxBytes = coverage.maxSourceBytes ?? DEFAULT_SOURCE_BYTES
    const directory = join(this.root, runId)
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, `${sourceId}.raw.tmp`)
    const file = await open(temporary, 'w')
    const reader = response.body?.getReader()
    let prefix = Buffer.alloc(0)
    let bytes = 0
    let incomplete = false
    try {
      while (reader) {
        const chunk = await abortable(reader.read(), signal)
        if (chunk.done) break
        const kept = maxBytes === 0 ? chunk.value : chunk.value.subarray(0, maxBytes - bytes)
        await file.writeFile(kept)
        if (prefix.length < 1024) prefix = Buffer.concat([prefix, kept.subarray(0, 1024 - prefix.length)])
        bytes += kept.length
        if (kept.length < chunk.value.length) { incomplete = true; break }
        if (maxBytes > 0 && bytes === maxBytes) {
          const next = await abortable(reader.read(), signal)
          if (!next.done) incomplete = true
          break
        }
      }
      signal.throwIfAborted()
      await file.close()
      if (contentType.split(';')[0].trim() === 'application/pdf' || /^\s*%PDF-/.test(prefix.toString('latin1'))) {
        if (incomplete) throw new Error(`PDF exceeds max_source_bytes (${maxBytes}); expand with a larger byte budget or 0 to download the complete PDF`)
        if (!this.readPdf) throw new Error('PDF reader is unavailable; use search.run expand with method exa for provider text')
        const extracted = await this.readPdf(temporary, textLimit(coverage), signal)
        signal.throwIfAborted()
        await writeFile(join(directory, `${sourceId}.txt.tmp`), extracted.text)
        await rename(temporary, join(directory, `${sourceId}.raw`))
        signal.throwIfAborted()
        await rename(join(directory, `${sourceId}.txt.tmp`), join(directory, `${sourceId}.txt`))
        return {
          ...extracted, url, contentType: 'application/pdf', representation: 'pdf_text',
          sha256: createHash('sha256').update(extracted.text).digest('hex'),
          dates: this.transportDates(response)
        }
      }
      if (!/^text\/|application\/(?:json|[^;]+\+json|xhtml\+xml)/.test(contentType)) {
        throw new Error(`Unsupported source type: ${contentType || 'missing content-type'}; body is not a PDF`)
      }
      const raw = await readFile(temporary, 'utf8')
      const extracted = documentText(raw, contentType)
      const text = boundedText(extracted.text, textLimit(coverage))
      if (!text.trim()) throw new SourceNeedsRendering('No readable source text; the page may require JavaScript')
      const document: SourceDocument = {
        text, title: extracted.title, url, contentType, representation: 'static_text',
        sha256: createHash('sha256').update(text).digest('hex'),
        dates: mergeDates(extracted.dates, this.transportDates(response)),
        incomplete: incomplete || extracted.text.length > text.length
      }
      if (contentType.includes('html') && text.length < SHELL_TEXT_LIMIT && /<script[\s>]/i.test(raw)) document.sparse = true
      await rename(temporary, join(directory, `${sourceId}.raw`))
      await writeFile(join(directory, `${sourceId}.txt.tmp`), text)
      signal.throwIfAborted()
      await rename(join(directory, `${sourceId}.txt.tmp`), join(directory, `${sourceId}.txt`))
      return document
    } finally {
      await reader?.cancel().catch(() => {})
      await file.close().catch(() => {})
      await rm(temporary, { force: true })
      await rm(join(directory, `${sourceId}.txt.tmp`), { force: true })
    }
  }

  private transportDates(response: Response): SourceDate[] {
    return response.headers.has('last-modified') ? [{
      kind: 'http_last_modified', value: response.headers.get('last-modified')!, source: 'http:Last-Modified'
    }] : []
  }
}
