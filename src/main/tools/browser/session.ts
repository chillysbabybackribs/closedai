import { allSettledBounded } from '../../bounded-concurrency.js'
import { defineActionTool, type ToolAction } from '../action-tool.js'
import { jsonResult, MAX_OUTPUT_CHARS, objectSchema } from '../json-result.js'
import { booleanArg, failureResult, numberArg, stringArg, type JsonObject, type ToolDefinition } from '../tool.js'
import { truncateText } from '../truncate-json.js'
import { SESSION_FETCH_TRUNCATION_ADVICE } from '../truncation-advice.js'
import { bodyField, FETCH_TIMEOUT_MS, headersField, methodField, parseBody } from './fetch.js'
import { requireSession, type SessionHostProvider } from './network-host.js'
import { projectJson } from './project.js'
import { documentText } from '../search/research/source-reader.js'
import { textWindow } from './text-window.js'

// The user's signed-in browser session as a data source: requests the main process makes on
// that session carry its cookies but answer to no page's CORS policy, and cookies are readable
// and writable for any domain without a page being open there.

const DEFAULT_BODY_CHARS = 6_000
const MAX_BODY_CHARS = 100_000
const DEFAULT_COOKIE_LIMIT = 50
const FETCH_MANY_MAX_URLS = 12
const FETCH_MANY_CONCURRENCY = 4

const urlField: JsonObject = { type: 'string', minLength: 1, description: 'Absolute URL. For cookies, the URL whose cookies apply.' }
const domainField: JsonObject = { type: 'string', minLength: 1, description: 'Cookie domain, for example example.com or .example.com.' }
const nameField: JsonObject = { type: 'string', minLength: 1, description: 'Cookie name.' }

export function sessionTool(sessions: SessionHostProvider): ToolDefinition {
  return defineActionTool({
    name: 'session',
    deferLoading: true,
    description:
      'Headless session HTTP (no visible tab): fetch and fetch_many for known URLs; cookies read/write. ' +
      'Prefer fetch_many for independent official doc URLs in one call. Use embedded_browser.script fetch only when JS in the page must run the request.',
    actions: [fetchAction(sessions), fetchManyAction(sessions), cookiesAction(sessions), setCookieAction(sessions), removeCookieAction(sessions)]
  })
}

function fetchAction(sessions: SessionHostProvider): ToolAction {
  return {
    action: 'fetch',
    description:
      'Send a request with session cookies and no page CORS; redirects follow unless manual. HTML defaults to readable text; raw markup and response headers are opt-in. ' +
      'Use text_contains for a passage, offset/nextOffset for more text (each call refetches; content may change). Project JSON with json_path/fields/limit. Binary is base64.',
    inputSchema: objectSchema({
      url: urlField,
      method: methodField,
      headers: headersField,
      body: bodyField,
      redirect: { type: 'string', enum: ['follow', 'manual'], description: 'Follow redirects (default) or stop at the first.' },
      format: { type: 'string', enum: ['raw', 'text'], description: 'HTML response format: text (default) extracts prose and title; raw preserves markup. JSON is parsed in either mode.' },
      include_headers: { type: 'boolean', description: 'Include response headers. Default false; request headers are always sent when supplied.' },
      text_contains: { type: 'string', minLength: 1, description: 'Case-insensitive literal passage search in non-JSON text, starting at offset. Returns context from up to 400 characters before the first match; matchOffset null means absent in the fetched text. GET/HEAD only.' },
      offset: { type: 'integer', minimum: 0, description: 'Character offset in non-JSON text (after HTML extraction). Use nextOffset to continue; refetches, so content may change. GET/HEAD only.' },
      json_path: { type: 'string', minLength: 1, description: 'Dot/bracket path into a JSON response, for example `data.items` or `results[0].rows`. Defaults to the whole document.' },
      fields: { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1 }, description: 'Field paths kept from each item, for example ["name","owner.login"]. Every field when omitted.' },
      limit: { type: 'integer', minimum: 1, description: 'Maximum items returned when the selection is an array.' },
      max_chars: { type: 'integer', minimum: 200, maximum: MAX_BODY_CHARS, description: `Body text limit; default ${DEFAULT_BODY_CHARS}, also bounded by the serialized output budget. Use nextOffset or text_contains rather than raising this after truncation.` }
    }, ['url']),
    timeoutMs: FETCH_TIMEOUT_MS,
    run: async (input) => runSessionFetch(sessions, input)
  }
}

function fetchManyAction(sessions: SessionHostProvider): ToolAction {
  return {
    action: 'fetch_many',
    description:
      'Parallel GET session fetches for 2–12 known URLs in one call (vendor compares, multi-page docs). ' +
      'No tab or CDP. Shared text_contains/json_path/fields apply to every URL. For SPA JSON after load, use browser_cdp.capture_spa.',
    inputSchema: objectSchema({
      urls: {
        type: 'array',
        minItems: 2,
        maxItems: FETCH_MANY_MAX_URLS,
        items: urlField,
        description: 'Absolute URLs to fetch in parallel with session cookies.'
      },
      format: { type: 'string', enum: ['raw', 'text'], description: 'HTML response format: text (default) extracts prose and title; raw preserves markup. JSON is parsed in either mode.' },
      text_contains: { type: 'string', minLength: 1, description: 'Case-insensitive literal passage search in non-JSON text, starting at offset. Returns context from up to 400 characters before the first match; matchOffset null means absent in the fetched text. GET/HEAD only.' },
      json_path: { type: 'string', minLength: 1, description: 'Dot/bracket path into a JSON response, for example `data.items` or `results[0].rows`. Defaults to the whole document.' },
      fields: { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1 }, description: 'Field paths kept from each item, for example ["name","owner.login"]. Every field when omitted.' },
      limit: { type: 'integer', minimum: 1, description: 'Maximum items returned when the selection is an array.' },
      max_chars: { type: 'integer', minimum: 200, maximum: MAX_BODY_CHARS, description: `Body text limit; default ${DEFAULT_BODY_CHARS}, also bounded by the serialized output budget. Use nextOffset or text_contains rather than raising this after truncation.` }
    }, ['urls']),
    timeoutMs: FETCH_TIMEOUT_MS + 10_000,
    run: async (input) => {
      const urls = input.urls
      if (!Array.isArray(urls)) return failureResult('`urls` must be an array of strings.')
      if (urls.length < 2) return failureResult('fetch_many requires at least two urls.')
      if (urls.length > FETCH_MANY_MAX_URLS) return failureResult(`fetch_many accepts at most ${FETCH_MANY_MAX_URLS} urls.`)
      const settled = await allSettledBounded(urls.map(String), FETCH_MANY_CONCURRENCY, async (url, index) => {
        const single = await runSessionFetch(sessions, { ...input, url, action: 'fetch', method: 'GET' })
        const block = single.content[0]
        const text = block?.type === 'text' ? block.text ?? '{}' : '{}'
        const parsed = JSON.parse(text) as Record<string, unknown>
        return { index: index + 1, url, ...(single.isError ? { error: true, ...parsed } : { ok: true, ...parsed }) }
      })
      const results = settled.map((entry, index) => {
        if (entry.status === 'rejected') {
          return { index: index + 1, url: String(urls[index]), error: true, message: String(entry.reason) }
        }
        return entry.value
      })
      return jsonResult({ returned: results.length, results })
    }
  }
}

async function runSessionFetch(sessions: SessionHostProvider, input: JsonObject) {
  const method = stringArg(input, 'method', 'GET')!
  if ((input.offset !== undefined || input.text_contains !== undefined) && !['GET', 'HEAD'].includes(method)) {
    return failureResult('offset and text_contains require GET or HEAD; do not repeat a mutating request to page its response.')
  }
  const response = await requireSession(sessions).fetch({
    url: stringArg(input, 'url')!,
    method,
    headers: headersFrom(input),
    body: stringArg(input, 'body'),
    redirect: stringArg(input, 'redirect') as 'follow' | 'manual' | undefined
  })
  const maxChars = numberArg(input, 'max_chars', DEFAULT_BODY_CHARS)
  const format = stringArg(input, 'format', 'text')!
  const { text, headers, ...responseMeta } = response
  const rest = { ...responseMeta, ...(input.include_headers === true ? { headers } : {}) }
  if (text === null) return jsonResult({ ...rest, binary: true, base64: rest.base64 && rest.base64.length > maxChars ? rest.base64.slice(0, maxChars) : rest.base64 })
  const { json, isJson } = parseBody(text, response.contentType)
  if (isJson && (input.offset !== undefined || input.text_contains !== undefined)) {
    return failureResult('This response is JSON; use json_path, fields, and limit instead of text offsets or text_contains.')
  }
  const path = stringArg(input, 'json_path')
  const fields = fieldsFrom(input)
  const limit = input.limit === undefined ? undefined : numberArg(input, 'limit', 0)
  if (isJson && (path || fields || limit !== undefined)) {
    const projected = projectJson(json, { path, fields, limit })
    if (projected.value === undefined) {
      return failureResult(`No value at json_path ${JSON.stringify(path)}. Call fetch without it first to see the response shape.`)
    }
    return jsonResult({
      ...rest,
      base64: null,
      isJson: true,
      ...(path ? { jsonPath: path } : {}),
      ...(projected.matched === null ? {} : { matched: projected.matched, returned: Array.isArray(projected.value) ? projected.value.length : 1 }),
      ...(projected.limited ? { limited: true } : {}),
      json: projected.value
    })
  }
  let bodyText = text
  let pageTitle: string | undefined
  if (format === 'text') {
    const doc = documentText(text, response.contentType ?? '')
    bodyText = doc.text
    if (doc.title) pageTitle = doc.title
  }
  if (!isJson) {
    return textWindow(bodyText, {
      ...rest, base64: null, isJson: false, format,
      ...(pageTitle ? { title: pageTitle } : {})
    }, {
      maxChars, offset: numberArg(input, 'offset', 0), contains: stringArg(input, 'text_contains'),
      sourceTruncated: response.truncated, canContinue: ['GET', 'HEAD'].includes(method)
    })
  }
  const bounded = truncateText(bodyText, maxChars, SESSION_FETCH_TRUNCATION_ADVICE)
  const payload = {
    ...rest,
    base64: null,
    isJson,
    ...(pageTitle ? { title: pageTitle } : {}),
    ...(format === 'text' ? { format: 'text' } : {}),
    bodyTruncated: bounded.truncated || response.truncated,
    ...(!bounded.truncated ? { json } : { text: bounded.text })
  }
  payload.bodyTruncated ||= JSON.stringify(payload, null, 2).length > MAX_OUTPUT_CHARS
  return jsonResult(payload)
}

function cookiesAction(sessions: SessionHostProvider): ToolAction {
  return {
    action: 'cookies',
    description: 'List cookies in the session store, filtered by url, domain, or name. Values are returned in full.',
    inputSchema: objectSchema({
      url: urlField,
      domain: domainField,
      name: nameField,
      max_cookies: { type: 'integer', minimum: 1, maximum: 500, description: `Maximum cookies returned; default ${DEFAULT_COOKIE_LIMIT}.` }
    }),
    run: async (input) => jsonResult(await requireSession(sessions).cookies({
      url: stringArg(input, 'url'),
      domain: stringArg(input, 'domain'),
      name: stringArg(input, 'name'),
      limit: numberArg(input, 'max_cookies', DEFAULT_COOKIE_LIMIT)
    }))
  }
}

function setCookieAction(sessions: SessionHostProvider): ToolAction {
  return {
    action: 'set_cookie',
    description: 'Create or overwrite a cookie. Give url or domain; expires_at is seconds since the epoch and omitted means a session cookie.',
    inputSchema: objectSchema({
      name: nameField,
      value: { type: 'string', description: 'Cookie value.' },
      url: urlField,
      domain: domainField,
      path: { type: 'string', minLength: 1, description: 'Cookie path; default /.' },
      secure: { type: 'boolean', description: 'Secure flag.' },
      http_only: { type: 'boolean', description: 'HttpOnly flag.' },
      expires_at: { type: 'number', minimum: 0, description: 'Expiry as seconds since the epoch.' },
      same_site: { type: 'string', enum: ['unspecified', 'no_restriction', 'lax', 'strict'], description: 'SameSite policy.' }
    }, ['name', 'value']),
    run: async (input) => jsonResult({
      cookie: await requireSession(sessions).setCookie({
        name: stringArg(input, 'name')!,
        value: stringArg(input, 'value', '')!,
        url: stringArg(input, 'url'),
        domain: stringArg(input, 'domain'),
        path: stringArg(input, 'path'),
        secure: input.secure === undefined ? undefined : booleanArg(input, 'secure', false),
        httpOnly: input.http_only === undefined ? undefined : booleanArg(input, 'http_only', false),
        expiresAt: input.expires_at === undefined ? undefined : numberArg(input, 'expires_at', 0),
        sameSite: stringArg(input, 'same_site') as 'unspecified' | 'no_restriction' | 'lax' | 'strict' | undefined
      })
    })
  }
}

function removeCookieAction(sessions: SessionHostProvider): ToolAction {
  return {
    action: 'remove_cookie',
    description: 'Remove a cookie by name for a url or domain.',
    inputSchema: objectSchema({ name: nameField, url: urlField, domain: domainField }, ['name']),
    run: async (input) => jsonResult(await requireSession(sessions).removeCookie({
      name: stringArg(input, 'name')!,
      url: stringArg(input, 'url'),
      domain: stringArg(input, 'domain')
    }))
  }
}

function fieldsFrom(input: JsonObject): string[] | undefined {
  const raw = input.fields
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw new Error('`fields` must be an array of strings')
  return raw.map((field) => String(field))
}

function headersFrom(input: JsonObject): Record<string, string> | undefined {
  const raw = input.headers
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('`headers` must be an object')
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) headers[name] = String(value)
  return headers
}
