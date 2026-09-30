import type { ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { failureResult, numberArg, stringArg } from '../tool.js'
import { requireSession, type SessionHostProvider } from '../browser/network-host.js'
import {
  DISCOVER_FOCUS_FIELD,
  DISCOVER_MAX_PROBE_BYTES_FIELD,
  DISCOVER_RESPECT_ROBOTS_FIELD,
  DISCOVER_TIMEOUT_MS_FIELD,
  DISCOVER_URL_FIELD
} from './discover-fields.js'
import {
  excerptFromBody,
  focusTokens,
  isHtmlContentType,
  isRobotsAllowed,
  normalizeExpandUrls,
  originOf,
  parseRobots,
  rankExpandUrls,
  resolveAgainstOrigin,
  type ProbeFetchMeta
} from './discover-probes.js'

const DEFAULT_MAX_PAGES = 6
const MAX_MAX_PAGES = 20
const MAX_URL_LIST = 40
const DEFAULT_MAX_EXCERPT = 2500
const MAX_MAX_EXCERPT = 12_000
const DEFAULT_MAX_PROBE_BYTES = 512_000
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 45_000
const FETCH_CONCURRENCY = 4

export function expandAction(sessions: SessionHostProvider): ToolAction {
  return {
    action: 'expand',
    description:
      'Bounded same-origin page fetches after bootstrap. Pass ranked URLs from sitemap, nav, or llms.txt. Loads robots.txt when respect_robots is true (default) and skips disallowed paths. Returns short prose excerpts — not a full crawl.',
    inputSchema: objectSchema({
      url: DISCOVER_URL_FIELD,
      urls: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Same-origin URLs to fetch (from bootstrap sitemap, nav, or llms.txt). Deduped; max 40 listed.'
      },
      focus: DISCOVER_FOCUS_FIELD,
      max_pages: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_MAX_PAGES,
        description: `Pages fetched after filtering; default ${DEFAULT_MAX_PAGES}.`
      },
      max_excerpt_chars: {
        type: 'integer',
        minimum: 200,
        maximum: MAX_MAX_EXCERPT,
        description: `Prose excerpt per page; default ${DEFAULT_MAX_EXCERPT}.`
      },
      max_probe_bytes: DISCOVER_MAX_PROBE_BYTES_FIELD,
      respect_robots: DISCOVER_RESPECT_ROBOTS_FIELD,
      timeout_ms: DISCOVER_TIMEOUT_MS_FIELD
    }, ['url', 'urls']),
    timeoutMs: MAX_TIMEOUT_MS,
    run: async (input, context) => {
      const seed = stringArg(input, 'url')!
      let seedUrl: string
      try {
        seedUrl = new URL(seed).toString()
      } catch {
        return failureResult('url must be an absolute http(s) URL.')
      }
      if (!/^https?:$/i.test(new URL(seedUrl).protocol)) return failureResult('url must be http or https.')

      const origin = originOf(seedUrl)
      const tokens = focusTokens(stringArg(input, 'focus'))
      const listed = normalizeExpandUrls(input.urls, origin, MAX_URL_LIST)
      if (!listed.length) return failureResult('urls must include at least one absolute http(s) URL on the seed origin.')

      const maxPages = numberArg(input, 'max_pages', DEFAULT_MAX_PAGES)
      const maxExcerpt = numberArg(input, 'max_excerpt_chars', DEFAULT_MAX_EXCERPT)
      const maxBytes = numberArg(input, 'max_probe_bytes', DEFAULT_MAX_PROBE_BYTES)
      const budgetMs = numberArg(input, 'timeout_ms', DEFAULT_TIMEOUT_MS)
      const respectRobots = input.respect_robots !== false
      const started = Date.now()
      const session = requireSession(sessions)
      const skipped: Array<{ url: string; reason: 'robots' | 'over_cap' }> = []
      const errors: Array<{ url: string; message: string }> = []

      let robotsRules = parseRobots('')
      if (respectRobots) {
        try {
          const robotsUrl = resolveAgainstOrigin(origin, '/robots.txt')
          const response = await session.fetch({ url: robotsUrl, method: 'GET', redirect: 'follow' })
          if (response.text && response.status >= 200 && response.status < 400) {
            robotsRules = parseRobots(response.text)
          }
        } catch {
          /* treat as no rules */
        }
      }

      const ranked = rankExpandUrls(listed, tokens)
      const queue: string[] = []
      for (const candidate of ranked) {
        if (queue.length >= maxPages) {
          skipped.push({ url: candidate, reason: 'over_cap' })
          continue
        }
        if (respectRobots && !isRobotsAllowed(candidate, robotsRules)) {
          skipped.push({ url: candidate, reason: 'robots' })
          continue
        }
        queue.push(candidate)
      }

      const pages: Array<{
        url: string
        finalUrl: string
        status: number
        title: string
        excerpt: string
        contentType: string | null
        byteLength: number
        sparse?: boolean
        fetch: ProbeFetchMeta
      }> = []

      const fetchOne = async (target: string): Promise<void> => {
        const t0 = Date.now()
        if (context.signal.aborted) return
        if (Date.now() - started > budgetMs) {
          errors.push({ url: target, message: 'timeout budget exhausted' })
          return
        }
        try {
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
          if (response.byteLength > maxBytes && !(response.text && isHtmlContentType(response.contentType))) {
            meta.error = `body exceeds max_probe_bytes (${response.byteLength})`
            errors.push({ url: target, message: meta.error })
            pages.push({
              url: target,
              finalUrl: meta.finalUrl,
              status: meta.status,
              title: '',
              excerpt: '',
              contentType: meta.contentType,
              byteLength: meta.byteLength,
              fetch: meta
            })
            return
          }
          let text = response.text ?? ''
          if (response.byteLength > maxBytes && response.text && isHtmlContentType(response.contentType)) {
            meta.parseTruncated = true
            text = response.text.slice(0, maxBytes)
          }
          if (meta.status < 200 || meta.status >= 400 || !text) {
            if (!meta.error && meta.status >= 400) meta.error = `HTTP ${meta.status}`
            if (meta.error) errors.push({ url: target, message: meta.error })
            pages.push({
              url: target,
              finalUrl: meta.finalUrl,
              status: meta.status,
              title: '',
              excerpt: '',
              contentType: meta.contentType,
              byteLength: meta.byteLength,
              fetch: meta
            })
            return
          }
          const { title, excerpt, sparse } = excerptFromBody(text, meta.contentType, maxExcerpt)
          pages.push({
            url: target,
            finalUrl: meta.finalUrl,
            status: meta.status,
            title,
            excerpt,
            contentType: meta.contentType,
            byteLength: meta.byteLength,
            sparse,
            fetch: meta
          })
        } catch (error) {
          errors.push({
            url: target,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }

      let index = 0
      const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
        while (index < queue.length) {
          const current = queue[index++]
          await fetchOne(current!)
        }
      })
      await Promise.all(workers)

      return jsonResult({
        seed: { url: seedUrl, origin },
        focus: stringArg(input, 'focus') ?? null,
        respectRobots,
        requested: listed.length,
        queued: queue.length,
        fetched: pages.filter((row) => row.excerpt.length > 0).length,
        skipped,
        pages,
        errors,
        elapsedMs: Date.now() - started
      })
    }
  }
}
