// A request made by the main process on the browser's own session carries the user's cookies
// and goes through Chromium's network stack, but is not a page, so no CORS policy applies and
// no page has to be open on the right origin. This is the request the in-page fetch cannot
// make: a cross-origin API that answers only to the signed-in session.

export type SessionFetchRequest = {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  /** Follow redirects (default) or stop at the first one and report it. */
  redirect?: 'follow' | 'manual'
}

export type SessionFetchResult = {
  url: string
  finalUrl: string
  status: number
  ok: boolean
  redirected: boolean
  headers: Record<string, string>
  contentType: string | null
  /** Decoded text, or null when the body is binary. */
  text: string | null
  /** Base64 of the bytes when the body is binary; bounded by the same ceiling. */
  base64: string | null
  byteLength: number
  truncated: boolean
}

/** A fetch bound to one session, for example `session.fetch.bind(session)`. */
export type SessionFetcher = (url: string, init: RequestInit) => Promise<Response>

/** Stops a pathological body from being marshalled whole; the tool bounds the rest. */
export const SESSION_BODY_CEILING = 1_000_000

export async function fetchWithSession(fetcher: SessionFetcher, request: SessionFetchRequest): Promise<SessionFetchResult> {
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    credentials: 'include',
    redirect: request.redirect ?? 'follow'
  }
  if (request.body !== undefined) init.body = request.body
  const response = await fetcher(request.url, init)
  const bytes = Buffer.from(await response.arrayBuffer())
  const kept = bytes.subarray(0, SESSION_BODY_CEILING)
  const decoded = decodeBytes(kept)
  const headers: Record<string, string> = {}
  response.headers.forEach((value, name) => { headers[name] = value })
  return {
    url: request.url,
    finalUrl: response.url || request.url,
    status: response.status,
    ok: response.ok,
    redirected: response.redirected,
    headers,
    contentType: response.headers.get('content-type'),
    text: decoded.text,
    base64: decoded.text === null ? kept.toString('base64') : null,
    byteLength: bytes.byteLength,
    truncated: bytes.byteLength > SESSION_BODY_CEILING
  }
}

/** Text when it reads as text; otherwise null so a binary body never becomes mojibake. */
export function decodeBytes(bytes: Buffer): { text: string | null } {
  if (bytes.byteLength === 0) return { text: '' }
  const text = bytes.toString('utf8')
  const replacementRatio = (text.match(/\uFFFD/g)?.length ?? 0) / Math.max(1, text.length)
  const printable = text.indexOf(String.fromCharCode(0)) === -1 && replacementRatio < 0.02
  return { text: printable ? text : null }
}

/** Hop-by-hop and session-managed headers that must not be replayed verbatim. */
const NON_REPLAYABLE_HEADERS = new Set([
  'content-length', 'host', 'cookie', 'connection', 'accept-encoding', 'transfer-encoding', 'upgrade', 'keep-alive', 'proxy-authorization'
])

/** Request headers safe to send again from the session; cookies are supplied by the session itself. */
export function replayableHeaders(headers: Record<string, string> | null): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase()
    if (NON_REPLAYABLE_HEADERS.has(lower) || lower.startsWith(':')) continue
    kept[name] = value
  }
  return kept
}
