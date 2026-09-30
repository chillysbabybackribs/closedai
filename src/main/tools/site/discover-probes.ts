import { documentText } from '../search/research/source-reader.js'

export type DiscoverChannel = 'robots' | 'sitemap' | 'llms_txt' | 'openapi' | 'html' | 'feeds'

export const ALL_DISCOVER_CHANNELS: DiscoverChannel[] = [
  'robots',
  'sitemap',
  'llms_txt',
  'openapi',
  'html',
  'feeds'
]

export type ProbeFetchMeta = {
  requestedUrl: string
  finalUrl: string
  status: number
  contentType: string | null
  byteLength: number
  durationMs: number
  error: string | null
  /** HTML channel only: only the first max_probe_bytes were parsed; full body was larger. */
  parseTruncated?: boolean
}

export function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const lower = contentType.toLowerCase()
  return lower.includes('text/html') || lower.includes('application/xhtml')
}

export type RobotsParse = {
  sitemaps: string[]
  rules: Array<{ agent: string; allow: string[]; disallow: string[] }>
}

export type SitemapEntry = {
  loc: string
  lastmod?: string
  priority?: number
  score?: number
}

export type LlmsLink = { text: string; href: string }

export type HtmlDiscover = {
  title: string
  canonical: string | null
  jsonLd: Array<{ type: string; name?: string }>
  navLinks: Array<{ text: string; href: string; sameOrigin: boolean }>
  feedCandidates: Array<{ href: string; type: string }>
}

const OPENAPI_CANDIDATES = ['/openapi.json', '/swagger.json', '/api/openapi.json', '/v3/api-docs']
const LLMS_CANDIDATES = ['/llms.txt', '/llms-full.txt', '/.well-known/llms.txt']
const FEED_CANDIDATES = ['/feed', '/rss.xml', '/atom.xml', '/feed.xml', '/index.xml']

export function originOf(url: string): string {
  const parsed = new URL(url)
  return `${parsed.protocol}//${parsed.host}`
}

export function resolveAgainstOrigin(origin: string, path: string): string {
  return new URL(path, origin.endsWith('/') ? origin : `${origin}/`).toString()
}

export function parseChannels(input: unknown): DiscoverChannel[] {
  if (input === undefined) return [...ALL_DISCOVER_CHANNELS]
  if (!Array.isArray(input)) return [...ALL_DISCOVER_CHANNELS]
  const set = new Set<DiscoverChannel>()
  for (const item of input) {
    if (typeof item === 'string' && (ALL_DISCOVER_CHANNELS as string[]).includes(item)) set.add(item as DiscoverChannel)
  }
  return set.size ? [...set] : [...ALL_DISCOVER_CHANNELS]
}

export function focusTokens(focus: string | undefined): string[] {
  if (!focus?.trim()) return []
  return focus
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 12)
}

export function parseRobots(text: string): RobotsParse {
  const sitemaps: string[] = []
  const rules: RobotsParse['rules'] = []
  let agent = '*'
  let allow: string[] = []
  let disallow: string[] = []

  const flush = () => {
    if (allow.length || disallow.length || agent !== '*') rules.push({ agent, allow: [...allow], disallow: [...disallow] })
    allow = []
    disallow = []
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0]?.trim() ?? ''
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key === 'user-agent') {
      flush()
      agent = value || '*'
      continue
    }
    if (key === 'allow') allow.push(value)
    if (key === 'disallow') disallow.push(value)
    if (key === 'sitemap' && value) sitemaps.push(value)
  }
  flush()
  return { sitemaps, rules }
}

export function parseSitemapLocs(xml: string, cap: number): { locs: SitemapEntry[]; childSitemaps: string[] } {
  const locs: SitemapEntry[] = []
  const childSitemaps: string[] = []
  const urlBlocks = xml.match(/<url\b[\s\S]*?<\/url>/gi) ?? []
  for (const block of urlBlocks) {
    if (locs.length >= cap) break
    const loc = tagText(block, 'loc')
    if (!loc) continue
    const lastmod = tagText(block, 'lastmod') ?? undefined
    const priorityRaw = tagText(block, 'priority')
    const priority = priorityRaw ? Number(priorityRaw) : undefined
    locs.push({ loc, lastmod, priority: Number.isFinite(priority) ? priority : undefined })
  }
  if (locs.length) return { locs, childSitemaps }
  const indexBlocks = xml.match(/<sitemap\b[\s\S]*?<\/sitemap>/gi) ?? []
  for (const block of indexBlocks) {
    const loc = tagText(block, 'loc')
    if (loc) childSitemaps.push(loc)
  }
  return { locs, childSitemaps }
}

function tagText(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))
  if (!match) return null
  return decodeXml(match[1]?.trim() ?? '')
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function parseLlmsTxt(text: string, maxChars: number): { excerpt: string; links: LlmsLink[] } {
  const excerpt = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
  const links: LlmsLink[] = []
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(text)) && links.length < 40) {
    links.push({ text: match[1]!.trim(), href: match[2]!.trim() })
  }
  return { excerpt, links }
}

export function parseHtmlDiscover(html: string, pageUrl: string): HtmlDiscover {
  const doc = documentText(html, 'text/html')
  const origin = originOf(pageUrl)
  const canonical =
    attrMatch(html, 'link', 'rel', 'canonical', 'href') ??
    (() => {
      try {
        return new URL(pageUrl).href
      } catch {
        return null
      }
    })()
  const jsonLd: HtmlDiscover['jsonLd'] = []
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let scriptMatch: RegExpExecArray | null
  while ((scriptMatch = scriptRe.exec(html)) && jsonLd.length < 8) {
    try {
      const payload = JSON.parse(scriptMatch[1]!.trim())
      collectJsonLd(payload, jsonLd)
    } catch {
      /* ignore invalid blocks */
    }
  }
  const feedCandidates: HtmlDiscover['feedCandidates'] = []
  const feedLinkRe = /<link\b[^>]*>/gi
  let linkTag: RegExpExecArray | null
  while ((linkTag = feedLinkRe.exec(html)) && feedCandidates.length < 6) {
    const tag = linkTag[0]!
    const rel = attrInTag(tag, 'rel')?.toLowerCase() ?? ''
    const type = attrInTag(tag, 'type')?.toLowerCase() ?? ''
    const href = attrInTag(tag, 'href')
    if (!href) continue
    if (rel.includes('alternate') && (type.includes('rss') || type.includes('atom') || type.includes('xml'))) {
      feedCandidates.push({ href: absolutize(href, pageUrl), type: type.includes('atom') ? 'atom' : 'rss' })
    }
  }
  const navLinks: HtmlDiscover['navLinks'] = []
  const seen = new Set<string>()
  const anchorRe = /<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let anchor: RegExpExecArray | null
  while ((anchor = anchorRe.exec(html)) && navLinks.length < 80) {
    const hrefRaw = anchor[1]!.trim()
    const text = stripTags(anchor[2]!).replace(/\s+/g, ' ').trim()
    if (!text || text.length > 120) continue
    const href = absolutize(hrefRaw, pageUrl)
    if (seen.has(href)) continue
    seen.add(href)
    let sameOrigin = false
    try {
      sameOrigin = originOf(href) === origin
    } catch {
      continue
    }
    if (!sameOrigin) continue
    navLinks.push({ text, href, sameOrigin })
  }
  return {
    title: doc.title || '',
    canonical,
    jsonLd,
    navLinks,
    feedCandidates
  }
}

function collectJsonLd(node: unknown, out: HtmlDiscover['jsonLd']): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLd(item, out)
    return
  }
  const record = node as Record<string, unknown>
  const typeRaw = record['@type']
  const types = Array.isArray(typeRaw) ? typeRaw : typeRaw ? [typeRaw] : []
  for (const type of types) {
    if (typeof type !== 'string') continue
    if (!/WebSite|Organization|SearchAction|WebPage/i.test(type)) continue
    out.push({ type, name: typeof record.name === 'string' ? record.name : undefined })
  }
  if (record['@graph']) collectJsonLd(record['@graph'], out)
}

function attrMatch(html: string, tag: string, attr: string, value: string, pick: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*${attr}=["']${escapeRegExp(value)}["'][^>]*${pick}=["']([^"']+)["']`, 'i')
  const alt = new RegExp(`<${tag}\\b[^>]*${pick}=["']([^"']+)["'][^>]*${attr}=["']${escapeRegExp(value)}["']`, 'i')
  return re.exec(html)?.[1]?.trim() ?? alt.exec(html)?.[1]?.trim() ?? null
}

function attrInTag(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
  return match?.[1]?.trim() ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '')
}

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

const DEPRIORITIZE_PATH = /\/(?:tag|tags|category|page|archive|author)\/|\?/i

export function rankSitemapEntries(entries: SitemapEntry[], tokens: string[], limit: number): SitemapEntry[] {
  const scored = entries.map((entry) => {
    let score = 0
    const locLower = entry.loc.toLowerCase()
    for (const token of tokens) {
      if (locLower.includes(token)) score += 10
    }
    if (entry.priority !== undefined) score += entry.priority * 2
    if (entry.lastmod) {
      const ageDays = (Date.now() - Date.parse(entry.lastmod)) / 86_400_000
      if (Number.isFinite(ageDays) && ageDays < 180) score += 2
    }
    if (DEPRIORITIZE_PATH.test(entry.loc)) score -= 3
    return { ...entry, score }
  })
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return scored.slice(0, limit)
}

export function rankNavLinks(links: HtmlDiscover['navLinks'], tokens: string[], limit: number): HtmlDiscover['navLinks'] {
  const scored = links.map((link) => {
    let score = 0
    const hay = `${link.text} ${link.href}`.toLowerCase()
    for (const token of tokens) {
      if (hay.includes(token)) score += 8
    }
    return { link, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((row) => row.link)
}

export function buildHints(payload: {
  llmsTxt?: { foundUrl: string | null; links: LlmsLink[] }
  openapi?: { foundUrl: string | null; pathCount?: number }
  sitemap?: { urls: SitemapEntry[] }
  html?: HtmlDiscover
  feeds?: Array<{ url: string; type: string }>
}): string[] {
  const hints: string[] = []
  if (payload.llmsTxt?.foundUrl) {
    hints.push(`llms.txt at ${payload.llmsTxt.foundUrl} — read excerpt links or session.fetch key paths`)
    const top = payload.llmsTxt.links[0]
    if (top) hints.push(`llms.txt link: ${top.text} → ${top.href}`)
  }
  if (payload.openapi?.foundUrl) {
    hints.push(
      payload.openapi.pathCount
        ? `OpenAPI at ${payload.openapi.foundUrl} (${payload.openapi.pathCount} paths) — session.fetch with json_path on paths`
        : `OpenAPI at ${payload.openapi.foundUrl} — session.fetch to inspect`
    )
  }
  const siteUrl = payload.sitemap?.urls[0]?.loc
  if (siteUrl) hints.push(`Top sitemap URL: ${siteUrl} — embedded_browser.page navigate or session.fetch`)
  const nav = payload.html?.navLinks[0]
  if (nav) hints.push(`Nav: ${nav.text} → ${nav.href}`)
  const feed = payload.feeds?.[0]
  if (feed) hints.push(`Feed (${feed.type}): ${feed.url}`)
  return hints.slice(0, 8).map((line) => (line.length > 200 ? `${line.slice(0, 197)}…` : line))
}

export function probeUrlsForOrigin(origin: string): { llms: string[]; openapi: string[]; feeds: string[] } {
  return {
    llms: LLMS_CANDIDATES.map((path) => resolveAgainstOrigin(origin, path)),
    openapi: OPENAPI_CANDIDATES.map((path) => resolveAgainstOrigin(origin, path)),
    feeds: FEED_CANDIDATES.map((path) => resolveAgainstOrigin(origin, path))
  }
}
