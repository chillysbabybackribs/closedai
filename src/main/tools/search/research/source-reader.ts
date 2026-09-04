import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { abortable, RequestBudget } from '../request-budget.js'

const MAX_BYTES = 512 * 1024
const MAX_TEXT = 120_000
const OMIT = new Set(['script', 'style', 'template', 'noscript', 'nav', 'footer', 'head'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'h1', 'h2', 'h3', 'h4', 'li', 'tr', 'br', 'pre'])

export type SourceDocument = {
  text: string; title: string; url: string; contentType: string; sha256: string; incomplete: boolean
}
export type SourceReader = (url: string, runId: string, sourceId: string, signal: AbortSignal) => Promise<SourceDocument>

export function publicUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) {
    throw new Error('Research sources must be HTTP(S) URLs without embedded credentials')
  }
  return url.href
}

/** Inert WHATWG parsing: no page script executes. https://github.com/inikulin/parse5 */
export function documentText(raw: string, contentType: string): { text: string; title: string } {
  if (!contentType.includes('html')) return { text: raw, title: '' }
  const document = parse(raw)
  let title = ''
  let main: DefaultTreeAdapterMap['node'] | undefined
  const nodes = [document as DefaultTreeAdapterMap['node']]
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if ('tagName' in node) {
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
  return { title, text: pieces.join('').replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim() }
}

/** Source files are confined to app-generated ids; callers never supply filesystem paths. */
export class SourceStore {
  private readonly budget = new RequestBudget(8, 2)

  constructor(readonly root: string, private readonly fetchPage: typeof fetch) {}

  async collect(url: string, runId: string, sourceId: string, signal: AbortSignal): Promise<SourceDocument> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
    return this.budget.run(new URL(url).origin, runId, deadline, async () => {
      let current = publicUrl(url)
      for (let redirect = 0; redirect <= 5; redirect++) {
        const response = await abortable(this.fetchPage(current, { signal: deadline, credentials: 'omit', redirect: 'manual' }), deadline)
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel()
          const location = response.headers.get('location')
          if (!location) throw new Error('Redirect did not include a location')
          current = publicUrl(new URL(location, current).href)
          continue
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(`Source returned HTTP ${response.status}`)
        }
        const type = (response.headers.get('content-type') ?? '').toLowerCase().slice(0, 120)
        if (!/^text\/|application\/(?:json|[^;]+\+json|xhtml\+xml)/.test(type)) {
          await response.body?.cancel()
          throw new Error(`Unsupported source type: ${type || 'missing content-type'}; open it in the browser`)
        }
        return this.archive(response, current, type, runId, sourceId, deadline)
      }
      throw new Error('Too many source redirects')
    })
  }

  async read(runId: string, sourceId: string): Promise<string> {
    return readFile(join(this.root, runId, `${sourceId}.txt`), 'utf8')
  }

  async remove(runId: string): Promise<void> {
    await rm(join(this.root, runId), { recursive: true, force: true })
  }

  private async archive(response: Response, url: string, contentType: string, runId: string, sourceId: string, signal: AbortSignal): Promise<SourceDocument> {
    const directory = join(this.root, runId)
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, `${sourceId}.raw.tmp`)
    const file = await open(temporary, 'w')
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let raw = ''
    let bytes = 0
    let incomplete = false
    try {
      while (reader) {
        const chunk = await abortable(reader.read(), signal)
        if (chunk.done) break
        const kept = chunk.value.subarray(0, MAX_BYTES - bytes)
        await file.write(kept)
        raw += decoder.decode(kept, { stream: true })
        bytes += kept.length
        if (bytes >= MAX_BYTES) { incomplete = true; break }
      }
      raw += decoder.decode()
      signal.throwIfAborted()
      const extracted = documentText(raw, contentType)
      const text = extracted.text.slice(0, MAX_TEXT)
      if (!text.trim()) throw new Error('No readable source text; the page may require JavaScript')
      const document = {
        text, title: extracted.title, url, contentType,
        sha256: createHash('sha256').update(text).digest('hex'),
        incomplete: incomplete || extracted.text.length > MAX_TEXT
      }
      await file.close()
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
}
