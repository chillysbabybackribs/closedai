import type { ScriptRunner } from './browser-page-ready.js'

// Fetching from inside the page the user is looking at, rather than from the main process,
// is what makes an endpoint reachable at all: the request inherits that tab's origin,
// cookies, and signed-in session, so same-origin APIs answer exactly as they do for the UI.
// The alternative — reconstructing auth in a main-process request — is both harder and wrong.

export type PageFetchRequest = {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
}

export type PageFetchResult = {
  url: string
  status: number
  ok: boolean
  contentType: string | null
  text: string
  /** Length of the response before the transfer ceiling was applied. */
  bodyLength: number
  /** True when the body hit the ceiling below, not the tool's own output budget. */
  truncated: boolean
}

/**
 * Ceiling on what crosses back from the page. Generous, because the caller still projects
 * and bounds the value before any of it reaches the model; this only stops a pathological
 * body from being marshalled through IPC in one piece.
 */
const BODY_CEILING = 1_000_000

export async function fetchInPage(
  contents: ScriptRunner,
  request: PageFetchRequest
): Promise<PageFetchResult | null> {
  if (contents.isDestroyed()) return null
  const init: Record<string, unknown> = { method: request.method, credentials: 'include' }
  if (request.headers) init.headers = request.headers
  if (request.body !== undefined) init.body = request.body
  const script = `(async () => {
    try {
      const response = await fetch(${JSON.stringify(request.url)}, ${JSON.stringify(init)});
      const body = await response.text();
      return {
        url: response.url,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
        bodyLength: body.length,
        text: body.length > ${BODY_CEILING} ? body.slice(0, ${BODY_CEILING}) : body
      };
    } catch (error) {
      return { failed: String(error && error.message ? error.message : error) };
    }
  })()`
  const raw = await contents.executeJavaScript(script, true)
  const record = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!record) return null
  if (typeof record.failed === 'string') throw new Error(`The page could not fetch ${request.url}: ${record.failed}`)
  const bodyLength = typeof record.bodyLength === 'number' ? record.bodyLength : 0
  return {
    url: typeof record.url === 'string' ? record.url : request.url,
    status: typeof record.status === 'number' ? record.status : 0,
    ok: record.ok === true,
    contentType: typeof record.contentType === 'string' ? record.contentType : null,
    text: typeof record.text === 'string' ? record.text : '',
    bodyLength,
    truncated: bodyLength > BODY_CEILING
  }
}
