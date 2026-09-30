import { defineActionTool, type ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { describeMissingTab } from '../../../shared/browser-tabs.js'
import { failureResult, numberArg, stringArg } from '../tool.js'
import type { BrowserHostProvider } from '../browser/host.js'
import { requireBrowser } from '../browser/host.js'
import { requireSession, type SessionHostProvider } from '../browser/network-host.js'
import {
  ALL_DISCOVER_CHANNELS,
  buildHints,
  focusTokens,
  originOf,
  parseChannels,
  parseHtmlDiscover,
  parseLlmsTxt,
  parseRobots,
  parseSitemapLocs,
  probeUrlsForOrigin,
  rankNavLinks,
  rankSitemapEntries,
  resolveAgainstOrigin,
  isHtmlContentType,
  type HtmlDiscover,
  type LlmsLink,
  type ProbeFetchMeta,
  type SitemapEntry
} from './discover-probes.js'
import {
  DISCOVER_FOCUS_FIELD,
  DISCOVER_MAX_PROBE_BYTES_FIELD,
  DISCOVER_TIMEOUT_MS_FIELD,
  DISCOVER_URL_FIELD
} from './discover-fields.js'
import { expandAction } from './expand.js'

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_TIMEOUT_MS = 45_000
const DEFAULT_MAX_SITEMAP = 40
const MAX_MAX_SITEMAP = 200
const DEFAULT_MAX_NAV = 30
const DEFAULT_MAX_LLMS = 4000
const DEFAULT_MAX_PROBE_BYTES = 512_000
const MAX_CONCURRENT = 6

export function discoverTool(sessions: SessionHostProvider, browser?: BrowserHostProvider) {
  return defineActionTool({
    name: 'discover',
    deferLoading: true,
    description:
      'Read-only site discovery for a URL origin. bootstrap probes robots, sitemap, llms.txt, OpenAPI hints, and landing HTML in parallel. expand fetches a bounded list of same-origin URLs with robots enforcement and prose excerpts. Uses the signed-in browser session — not a crawl. Pair with embedded_browser.page navigate and embedded_browser.session fetch.',
    actions: [bootstrapAction(sessions, browser), expandAction(sessions)]
  })
}

function bootstrapAction(sessions: SessionHostProvider, browser?: BrowserHostProvider): ToolAction {
  return {
    action: 'bootstrap',
    description:
      'Fetch well-known discovery documents for the seed URL origin in parallel. Optional tab_id merges HTML nav/meta from a live tab when its URL shares the origin. Use focus to rank sitemap and nav links.',
    inputSchema: objectSchema({
      url: DISCOVER_URL_FIELD,
      focus: DISCOVER_FOCUS_FIELD,
      channels: {
        type: 'array',
        items: { type: 'string', enum: ALL_DISCOVER_CHANNELS },
        description: 'Probes to run; default all.'
      },
      tab_id: { type: 'string', description: 'Optional tab id when HTML channel reads the live document.' },
      max_sitemap_urls: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_MAX_SITEMAP,
        description: `Sitemap URLs returned after ranking; default ${DEFAULT_MAX_SITEMAP}.`
      },
      max_nav_links: { type: 'integer', minimum: 1, maximum: 100, description: `Nav links returned; default ${DEFAULT_MAX_NAV}.` },
      max_llms_chars: { type: 'integer', minimum: 200, maximum: 20_000, description: `llms.txt excerpt size; default ${DEFAULT_MAX_LLMS}.` },
      max_probe_bytes: DISCOVER_MAX_PROBE_BYTES_FIELD,
      timeout_ms: DISCOVER_TIMEOUT_MS_FIELD
    }, ['url']),
    timeoutMs: MAX_TIMEOUT_MS,
    run: async (input, context) => {
      const url = stringArg(input, 'url')!
      let seedUrl: string
      try {
        seedUrl = new URL(url).toString()
      } catch {
        return failureResult('url must be an absolute http(s) URL.')
      }
      if (!/^https?:$/i.test(new URL(seedUrl).protocol)) return failureResult('url must be http or https.')

      const origin = originOf(seedUrl)
      const channels = new Set(parseChannels(input.channels))
      const tokens = focusTokens(stringArg(input, 'focus'))
      const maxSitemap = numberArg(input, 'max_sitemap_urls', DEFAULT_MAX_SITEMAP)
      const maxNav = numberArg(input, 'max_nav_links', DEFAULT_MAX_NAV)
      const maxLlms = numberArg(input, 'max_llms_chars', DEFAULT_MAX_LLMS)
      const maxBytes = numberArg(input, 'max_probe_bytes', DEFAULT_MAX_PROBE_BYTES)
      const budgetMs = numberArg(input, 'timeout_ms', DEFAULT_TIMEOUT_MS)
      const started = Date.now()
      const session = requireSession(sessions)
      const errors: Array<{ channel: string; message: string }> = []

      const fetchText = async (
        target: string,
        options?: { htmlParse?: boolean }
      ): Promise<{ meta: ProbeFetchMeta; text: string | null }> => {
        const t0 = Date.now()
        try {
          if (context.signal.aborted) throw new Error('aborted')
          if (Date.now() - started > budgetMs) throw new Error('timeout budget exhausted')
          const response = await session.fetch({ url: target, method: 'GET', redirect: 'follow' })
          const meta: ProbeFetchMeta = {
            requestedUrl: target,
            finalUrl: response.finalUrl,
            status: response.status,
            contentType: response.contentType,
            byteLength: response.byteLength,
            durationMs: Date.now() - t0,
            error: null
          }
          if (response.byteLength > maxBytes) {
            if (options?.htmlParse && response.text && isHtmlContentType(response.contentType)) {
              meta.parseTruncated = true
              return { meta, text: response.text.slice(0, maxBytes) }
            }
            meta.error = `body exceeds max_probe_bytes (${response.byteLength})`
            return { meta, text: null }
          }
          return { meta, text: response.text }
        } catch (error) {
          return {
            meta: {
              requestedUrl: target,
              finalUrl: target,
              status: 0,
              contentType: null,
              byteLength: 0,
              durationMs: Date.now() - t0,
              error: error instanceof Error ? error.message : String(error)
            },
            text: null
          }
        }
      }

      const robotsOut = emptyRobots()
      const llmsOut = emptyLlms()
      const sitemapOut = emptySitemap()
      const openapiOut = emptyOpenapi()
      const htmlOut = emptyHtml()
      const feedsOut: { ok: boolean; feeds: Array<{ url: string; type: string }> } = { ok: false, feeds: [] }

      if (channels.has('robots')) {
        const robotsUrl = resolveAgainstOrigin(origin, '/robots.txt')
        const { meta, text } = await fetchText(robotsUrl)
        robotsOut.fetch = meta
        if (text && meta.status >= 200 && meta.status < 400) {
          const parsed = parseRobots(text)
          robotsOut.ok = true
          robotsOut.sitemaps = parsed.sitemaps
          robotsOut.rules = parsed.rules
        } else if (meta.error) errors.push({ channel: 'robots', message: meta.error })
      }

      const tasks: Array<() => Promise<void>> = []

      if (channels.has('llms_txt')) {
        tasks.push(async () => {
          for (const candidate of probeUrlsForOrigin(origin).llms) {
            const { meta, text } = await fetchText(candidate)
            if (text && meta.status >= 200 && meta.status < 400) {
              const parsed = parseLlmsTxt(text, maxLlms)
              llmsOut.ok = true
              llmsOut.foundUrl = meta.finalUrl
              llmsOut.excerpt = parsed.excerpt
              llmsOut.links = parsed.links
              llmsOut.fetch = meta
              return
            }
            if (!llmsOut.fetch) llmsOut.fetch = meta
          }
        })
      }

      if (channels.has('openapi')) {
        tasks.push(async () => {
          for (const candidate of probeUrlsForOrigin(origin).openapi) {
            const { meta, text } = await fetchText(candidate)
            if (text && meta.status >= 200 && meta.status < 400 && meta.contentType?.includes('json')) {
              try {
                const doc = JSON.parse(text) as { info?: { title?: string }; paths?: Record<string, unknown> }
                openapiOut.ok = true
                openapiOut.foundUrl = meta.finalUrl
                openapiOut.title = doc.info?.title ?? null
                openapiOut.pathCount = doc.paths ? Object.keys(doc.paths).length : null
                openapiOut.fetch = meta
                return
              } catch {
                /* try next candidate */
              }
            }
          }
        })
      }

      if (channels.has('html')) {
        tasks.push(async () => {
          const tabId = stringArg(input, 'tab_id')
          if (tabId && browser) {
            const host = requireBrowser(browser)
            const tab = host.listTabs().find((row) => row.id === tabId)
            if (!tab) {
              errors.push({ channel: 'html', message: describeMissingTab(tabId, host.listTabs()) })
              return
            }
            if (originOf(tab.url) === origin) {
              const { meta, text } = await fetchText(tab.url, { htmlParse: true })
              if (text && meta.status >= 200 && meta.status < 400) {
                applyHtml(htmlOut, parseHtmlDiscover(text, meta.finalUrl), 'tab', meta, tokens, maxNav)
                if (channels.has('feeds')) applyFeedCandidates(feedsOut, text, meta.finalUrl)
                return
              }
            }
          }
          const { meta, text } = await fetchText(seedUrl, { htmlParse: true })
          htmlOut.fetch = meta
          if (text && meta.status >= 200 && meta.status < 400) {
            applyHtml(htmlOut, parseHtmlDiscover(text, meta.finalUrl), 'fetch', meta, tokens, maxNav)
            if (channels.has('feeds')) applyFeedCandidates(feedsOut, text, meta.finalUrl)
          } else if (meta.error) errors.push({ channel: 'html', message: meta.error })
        })
      } else if (channels.has('feeds')) {
        tasks.push(async () => {
          for (const candidate of probeUrlsForOrigin(origin).feeds) {
            const { meta } = await fetchText(candidate)
            if (meta.status >= 200 && meta.status < 400) {
              feedsOut.feeds = [{ url: meta.finalUrl, type: candidate.includes('atom') ? 'atom' : 'rss' }]
              feedsOut.ok = true
              return
            }
          }
        })
      }

      if (channels.has('sitemap')) {
        tasks.push(async () => {
          await loadSitemap(origin, robotsOut.sitemaps, fetchText, maxSitemap, tokens, sitemapOut)
        })
      }

      await runPool(tasks, MAX_CONCURRENT)

      const hints = buildHints({
        llmsTxt: { foundUrl: llmsOut.foundUrl, links: llmsOut.links },
        openapi: { foundUrl: openapiOut.foundUrl, pathCount: openapiOut.pathCount ?? undefined },
        sitemap: { urls: sitemapOut.urls },
        html: htmlOut.ok
          ? {
              title: htmlOut.title,
              canonical: htmlOut.canonical,
              jsonLd: htmlOut.jsonLd,
              navLinks: htmlOut.navLinks,
              feedCandidates: []
            }
          : undefined,
        feeds: feedsOut.feeds
      })

      return jsonResult({
        seed: { url: seedUrl, origin },
        focus: stringArg(input, 'focus') ?? null,
        channelsRun: [...channels],
        elapsedMs: Date.now() - started,
        robots: robotsOut,
        llmsTxt: llmsOut,
        sitemap: sitemapOut,
        openapi: openapiOut,
        html: htmlOut,
        feeds: feedsOut,
        hints,
        errors
      })
    }
  }
}

function emptyRobots() {
  return {
    ok: false as boolean,
    fetch: null as ProbeFetchMeta | null,
    sitemaps: [] as string[],
    rules: [] as Array<{ agent: string; allow: string[]; disallow: string[] }>
  }
}

function emptyLlms() {
  return {
    ok: false as boolean,
    foundUrl: null as string | null,
    excerpt: null as string | null,
    links: [] as LlmsLink[],
    fetch: null as ProbeFetchMeta | null
  }
}

function emptySitemap() {
  return {
    ok: false as boolean,
    sources: [] as Array<{ url: string; kind: 'urlset' | 'index' }>,
    matched: 0,
    returned: 0,
    urls: [] as SitemapEntry[]
  }
}

function emptyOpenapi() {
  return {
    ok: false as boolean,
    foundUrl: null as string | null,
    title: null as string | null,
    pathCount: null as number | null,
    fetch: null as ProbeFetchMeta | null
  }
}

function emptyHtml() {
  return {
    ok: false as boolean,
    source: 'fetch' as 'fetch' | 'tab',
    title: '',
    canonical: null as string | null,
    jsonLd: [] as HtmlDiscover['jsonLd'],
    navLinks: [] as HtmlDiscover['navLinks'],
    fetch: null as ProbeFetchMeta | null
  }
}

function applyHtml(
  htmlOut: ReturnType<typeof emptyHtml>,
  parsed: HtmlDiscover,
  source: 'fetch' | 'tab',
  fetch: ProbeFetchMeta,
  tokens: string[],
  maxNav: number
): void {
  htmlOut.ok = true
  htmlOut.source = source
  htmlOut.title = parsed.title
  htmlOut.canonical = parsed.canonical
  htmlOut.jsonLd = parsed.jsonLd
  htmlOut.navLinks = rankNavLinks(parsed.navLinks, tokens, maxNav)
  htmlOut.fetch = fetch
}

function applyFeedCandidates(feedsOut: { ok: boolean; feeds: Array<{ url: string; type: string }> }, html: string, baseUrl: string): void {
  const parsed = parseHtmlDiscover(html, baseUrl)
  feedsOut.feeds = parsed.feedCandidates.slice(0, 4).map((row) => ({ url: row.href, type: row.type }))
  feedsOut.ok = feedsOut.feeds.length > 0
}

async function loadSitemap(
  origin: string,
  robotsSitemaps: string[],
  fetchText: (target: string) => Promise<{ meta: ProbeFetchMeta; text: string | null }>,
  maxSitemap: number,
  tokens: string[],
  sitemapOut: ReturnType<typeof emptySitemap>
): Promise<void> {
  const sources: Array<{ url: string; kind: 'urlset' | 'index' }> = []
  const locs: SitemapEntry[] = []
  const queue = [resolveAgainstOrigin(origin, '/sitemap.xml'), ...robotsSitemaps]
  const seen = new Set<string>()
  while (queue.length && sources.length < 4 && locs.length < maxSitemap * 3) {
    const next = queue.shift()!
    if (seen.has(next)) continue
    seen.add(next)
    const { meta, text } = await fetchText(next)
    if (!text || meta.status < 200 || meta.status >= 400) continue
    const parsed = parseSitemapLocs(text, maxSitemap * 3)
    if (parsed.locs.length) {
      sources.push({ url: meta.finalUrl, kind: 'urlset' })
      locs.push(...parsed.locs)
      break
    }
    if (parsed.childSitemaps.length) {
      sources.push({ url: meta.finalUrl, kind: 'index' })
      for (const child of parsed.childSitemaps.slice(0, 3)) queue.push(child)
    }
  }
  const ranked = rankSitemapEntries(locs, tokens, maxSitemap)
  sitemapOut.ok = ranked.length > 0 || sources.length > 0
  sitemapOut.sources = sources
  sitemapOut.matched = locs.length
  sitemapOut.returned = ranked.length
  sitemapOut.urls = ranked
}

async function runPool(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (index < tasks.length) {
      const current = tasks[index++]
      await current!()
    }
  })
  await Promise.all(workers)
}
