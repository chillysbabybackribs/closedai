import type { CdpEventRecord } from './cdp-session.js'

// Finding the endpoint a page actually calls is the first move in most data work, and doing it
// by hand costs several round trips: enable Network, reload or re-act, page the event buffer,
// then match request ids. Two sources answer it directly instead.
//
// Resource timing is the important one: `performance.getEntriesByType('resource')` reports every
// request the page has already made, so it works retroactively on a tab that loaded before anyone
// was watching — no reload, no prior instrumentation. It knows URL, kind, size and timing but not
// method or status. The CDP event buffer knows method, status and request id, but only for traffic
// seen since Network was enabled. Merged on URL, they cover each other's blind spot.

export type NetworkRequestRecord = {
  url: string
  method: string | null
  status: number | null
  /** CDP resource type (XHR, Fetch, Script…) or the resource-timing initiator kind. */
  type: string | null
  /** Present only for buffered events; required by `Network.getResponseBody`. */
  requestId: string | null
  sizeBytes: number | null
  source: 'events' | 'timing' | 'both'
}

export type ResourceTimingEntry = {
  url: string
  type: string | null
  sizeBytes: number | null
}

export type RequestFilter = {
  /** Case-insensitive substring of the URL. */
  url?: string
  /** Case-insensitive substring of the resource type. */
  type?: string
  limit: number
}

/** Expression evaluated in the page; kept here so the shape and the parser stay together. */
export const RESOURCE_TIMING_EXPRESSION = `(() => {
  try {
    return performance.getEntriesByType('resource').map((entry) => ({
      url: entry.name,
      type: entry.initiatorType || null,
      sizeBytes: typeof entry.transferSize === 'number' ? entry.transferSize : null
    }));
  } catch (error) { return []; }
})()`

export function parseResourceTiming(value: unknown): ResourceTimingEntry[] {
  if (!Array.isArray(value)) return []
  const entries: ResourceTimingEntry[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.url !== 'string') continue
    entries.push({
      url: record.url,
      type: typeof record.type === 'string' && record.type ? record.type : null,
      sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : null
    })
  }
  return entries
}

/**
 * Fold buffered Network events into one record per request. `requestWillBeSent` carries the
 * method and url, `responseReceived` the status and type; both key on the same requestId.
 */
export function foldNetworkEvents(events: CdpEventRecord[]): NetworkRequestRecord[] {
  const byId = new Map<string, NetworkRequestRecord>()
  for (const event of events) {
    const params = event.params !== null && typeof event.params === 'object'
      ? event.params as Record<string, unknown>
      : null
    const requestId = params && typeof params.requestId === 'string' ? params.requestId : null
    if (!requestId) continue
    const current = byId.get(requestId) ?? {
      url: '', method: null, status: null, type: null, requestId, sizeBytes: null, source: 'events' as const
    }
    if (event.method === 'Network.requestWillBeSent') {
      const request = params?.request !== null && typeof params?.request === 'object'
        ? params.request as Record<string, unknown>
        : null
      if (typeof request?.url === 'string') current.url = request.url
      if (typeof request?.method === 'string') current.method = request.method
      if (typeof params?.type === 'string') current.type = params.type
    }
    if (event.method === 'Network.responseReceived') {
      const response = params?.response !== null && typeof params?.response === 'object'
        ? params.response as Record<string, unknown>
        : null
      if (typeof response?.status === 'number') current.status = response.status
      if (typeof response?.url === 'string' && !current.url) current.url = response.url
      if (typeof params?.type === 'string') current.type = params.type
    }
    byId.set(requestId, current)
  }
  return [...byId.values()].filter((record) => record.url.length > 0)
}

export type DecodedBody =
  | { text: string; base64Encoded: boolean; byteLength: number }
  | { text: null; base64Encoded: true; byteLength: number; note: string }

/**
 * CDP returns binary bodies base64-encoded. Decoding is worth it for text, and actively harmful
 * for an image: a megabyte of mojibake would sit in the transcript forever. Decode, then keep the
 * result only when it reads as text.
 */
export function decodeResponseBody(body: string, base64Encoded: boolean): DecodedBody {
  if (!base64Encoded) return { text: body, base64Encoded: false, byteLength: body.length }
  const bytes = Buffer.from(body, 'base64')
  const text = bytes.toString('utf8')
  const replacementRatio = (text.match(/\uFFFD/g)?.length ?? 0) / Math.max(1, text.length)
  const printable = text.length > 0 && !text.includes('\u0000') && replacementRatio < 0.02
  if (!printable) {
    return {
      text: null,
      base64Encoded: true,
      byteLength: bytes.byteLength,
      note: 'The body is binary; it was not decoded. Read it with a Network.getResponseBody command if you need the bytes.'
    }
  }
  return { text, base64Encoded: true, byteLength: bytes.byteLength }
}

export type MergedRequests = {
  /** Requests matching the filter before `limit` was applied. */
  matched: number
  requests: NetworkRequestRecord[]
}

/** Merge both sources on URL, preferring event data and marking what corroborated it. */
export function mergeRequests(
  fromEvents: NetworkRequestRecord[],
  fromTiming: ResourceTimingEntry[],
  filter: RequestFilter
): MergedRequests {
  const merged = new Map<string, NetworkRequestRecord>()
  for (const record of fromEvents) merged.set(record.url, { ...record })
  for (const entry of fromTiming) {
    const existing = merged.get(entry.url)
    if (existing) {
      // Only an event record corroborates a timing entry. A page that fetches the same URL
      // twice produces two timing entries, and calling that "both" would claim a captured
      // request id the record does not have.
      if (existing.source === 'events') existing.source = 'both'
      existing.type = existing.type ?? entry.type
      existing.sizeBytes = existing.sizeBytes ?? entry.sizeBytes
      continue
    }
    merged.set(entry.url, {
      url: entry.url,
      method: null,
      status: null,
      type: entry.type,
      requestId: null,
      sizeBytes: entry.sizeBytes,
      source: 'timing'
    })
  }
  const url = filter.url?.toLowerCase()
  const type = filter.type?.toLowerCase()
  const kept = [...merged.values()].filter((record) => {
    if (url && !record.url.toLowerCase().includes(url)) return false
    if (type && !(record.type ?? '').toLowerCase().includes(type)) return false
    return true
  })
  // Requests with a captured id sort first: those are the ones whose body can be read.
  kept.sort((left, right) => Number(Boolean(right.requestId)) - Number(Boolean(left.requestId)))
  // `matched` is what the filter found, not what fitted: without it a listing cut by `limit`
  // reads as "the endpoint is not there" rather than "narrow the filter".
  return { matched: kept.length, requests: kept.slice(0, filter.limit) }
}
