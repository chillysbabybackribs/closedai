import type { Recording } from '../../cdp/cdp-instrument.js'
import { originOf } from './discover-probes.js'

export type InstrumentFrameRecording = Recording & {
  sessionId?: string
  url?: string
  error?: string
}

export type InstrumentRecordingPayload = Recording & {
  frames?: InstrumentFrameRecording[]
}

export type ApiEndpointRow = {
  method: string
  url: string
  resolvedUrl: string
  sameOrigin: boolean
  channels: string[]
  count: number
  lastAtMs: number | null
  /** Recorder labels are capped; a URL at that boundary is only a discovery hint. */
  urlMayBeTruncated?: boolean
}

export type ApiMapResult = {
  installed: boolean
  pageUrl: string | null
  origin: string | null
  dropped: number
  channelCounts: Record<string, number>
  endpoints: ApiEndpointRow[]
  frames: Array<{ url: string | null; installed: boolean; error?: string }>
  hints: string[]
  message?: string
}

const HTTP_CHANNELS = new Set(['fetch', 'xhr'])

export function parseInstrumentHttpDetail(detail: string): { method: string; url: string } | null {
  const trimmed = detail.trim()
  const match = trimmed.match(/^([A-Za-z]+)\s+(\S+)$/)
  if (!match) return null
  return { method: match[1]!.toUpperCase(), url: match[2]! }
}

export function resolveInstrumentUrl(url: string, baseUrl: string | null): string {
  if (!baseUrl) return url
  try {
    return new URL(url, baseUrl).toString()
  } catch {
    return url
  }
}

export function buildApiMap(
  raw: unknown,
  options: { pageOrigin?: string | null; originOnly?: boolean; limit: number }
): ApiMapResult {
  const payload = raw as InstrumentRecordingPayload
  const pageUrl = typeof payload.url === 'string' ? payload.url : null
  const pageOrigin = options.pageOrigin ?? (pageUrl ? originOf(pageUrl) : null)
  const sources: Array<{ baseUrl: string | null; recording: Recording }> = [{ baseUrl: pageUrl, recording: payload }]
  for (const frame of payload.frames ?? []) {
    if (frame.error) continue
    sources.push({ baseUrl: frame.url ?? pageUrl, recording: frame })
  }

  const merged = new Map<string, ApiEndpointRow>()
  let dropped = Number(payload.dropped) || 0
  const channelCounts: Record<string, number> = { ...(payload.counts ?? {}) }
  for (const frame of payload.frames ?? []) {
    dropped += Number(frame.dropped) || 0
    for (const [key, value] of Object.entries(frame.counts ?? {})) {
      channelCounts[key] = (channelCounts[key] ?? 0) + value
    }
  }

  const ingest = (recording: Recording, baseUrl: string | null) => {
    // These are two views of the same buffer. Recent supplies timestamps and endpoints
    // absent from the bounded distinct list, never extra counts for a distinct entry.
    const keyOf = (row: { channel: string; detail: string }) => JSON.stringify([row.channel, row.detail])
    const rows = new Map((recording.distinct ?? []).map((row) => [keyOf(row), { ...row }]))
    const distinctKeys = new Set(rows.keys())
    for (const event of recording.recent ?? []) {
      const key = keyOf(event)
      if (distinctKeys.has(key)) continue
      const prior = rows.get(key)
      rows.set(key, { channel: event.channel, detail: event.detail, count: (prior?.count ?? 0) + 1 })
    }
    for (const row of rows.values()) {
      if (!HTTP_CHANNELS.has(row.channel) && row.channel !== 'websocket') continue
      let method = row.channel === 'websocket' ? 'WS' : ''
      let href = row.detail
      if (HTTP_CHANNELS.has(row.channel)) {
        const parsed = parseInstrumentHttpDetail(row.detail)
        if (!parsed) continue
        method = parsed.method
        href = parsed.url
      }
      const resolved = resolveInstrumentUrl(href, baseUrl)
      let sameOrigin = false
      try {
        sameOrigin = pageOrigin ? originOf(resolved) === pageOrigin : false
      } catch {
        sameOrigin = false
      }
      if (options.originOnly && pageOrigin && !sameOrigin) continue
      const key = `${method} ${resolved}`
      const existing = merged.get(key)
      const count = row.count ?? 1
      if (existing) {
        existing.count += count
        if (!existing.channels.includes(row.channel)) existing.channels.push(row.channel)
      } else {
        merged.set(key, {
          method,
          url: href,
          resolvedUrl: resolved,
          sameOrigin,
          channels: [row.channel],
          count,
          lastAtMs: null,
          ...(row.detail.length >= 200 ? { urlMayBeTruncated: true } : {})
        })
      }
    }
    for (const event of recording.recent ?? []) {
      if (!HTTP_CHANNELS.has(event.channel) && event.channel !== 'websocket') continue
      let method = event.channel === 'websocket' ? 'WS' : ''
      let href = event.detail
      if (HTTP_CHANNELS.has(event.channel)) {
        const parsed = parseInstrumentHttpDetail(event.detail)
        if (!parsed) continue
        method = parsed.method
        href = parsed.url
      }
      const resolved = resolveInstrumentUrl(href, baseUrl)
      const key = `${method} ${resolved}`
      const row = merged.get(key)
      if (row && (row.lastAtMs === null || event.atMs > row.lastAtMs)) row.lastAtMs = event.atMs
    }
  }

  if (payload.installed !== true) {
    return {
      installed: false,
      pageUrl,
      origin: pageOrigin,
      dropped: 0,
      channelCounts: {},
      endpoints: [],
      frames: (payload.frames ?? []).map((frame) => ({
        url: frame.url ?? null,
        installed: frame.installed === true,
        error: frame.error
      })),
      hints: [],
      message: 'No instrument recorder on this tab — browser_cdp.instrument hook before navigate, then interact.'
    }
  }

  for (const source of sources) {
    if (source.recording.installed !== true) continue
    ingest(source.recording, source.baseUrl)
  }

  const endpoints = [...merged.values()].sort((a, b) => b.count - a.count).slice(0, options.limit)
  const hints = endpoints.slice(0, 6).map((row) => {
    const target = row.resolvedUrl.length > 120 ? `${row.resolvedUrl.slice(0, 117)}…` : row.resolvedUrl
    return row.urlMayBeTruncated
      ? `${row.method} ${target} (×${row.count}) — clipped label; get the full URL from network.requests or browser_cdp.protocol requests`
      : `${row.method} ${target} (×${row.count}) — browser_cdp.protocol requests/body for captured evidence; session.fetch issues a new request`
  })

  const frames = (payload.frames ?? []).map((frame) => ({
    url: frame.url ?? null,
    installed: frame.installed === true,
    error: frame.error
  }))

  return {
    installed: true,
    pageUrl,
    origin: pageOrigin,
    dropped,
    channelCounts,
    endpoints,
    frames,
    hints
  }
}
