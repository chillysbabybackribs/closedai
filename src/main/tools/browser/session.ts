import { defineActionTool, type ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { booleanArg, numberArg, stringArg, type JsonObject, type ToolDefinition } from '../tool.js'
import { truncateText } from '../truncate-json.js'
import { bodyField, FETCH_TIMEOUT_MS, headersField, methodField, parseBody } from './fetch.js'
import { requireSession, type SessionHostProvider } from './network-host.js'

// The user's signed-in browser session as a data source: requests the main process makes on
// that session carry its cookies but answer to no page's CORS policy, and cookies are readable
// and writable for any domain without a page being open there.

const DEFAULT_BODY_CHARS = 20_000
const MAX_BODY_CHARS = 100_000
const DEFAULT_COOKIE_LIMIT = 50

const urlField: JsonObject = { type: 'string', minLength: 1, description: 'Absolute URL. For cookies, the URL whose cookies apply.' }
const domainField: JsonObject = { type: 'string', minLength: 1, description: 'Cookie domain, for example example.com or .example.com.' }
const nameField: JsonObject = { type: 'string', minLength: 1, description: 'Cookie name.' }

export function sessionTool(sessions: SessionHostProvider): ToolDefinition {
  return defineActionTool({
    name: 'session',
    description:
      'The browser\'s signed-in session, used directly from the app. fetch sends a request with the ' +
      'session\'s cookies from the main process, so cross-origin APIs that reject a page\'s fetch answer ' +
      'here, and response headers come back too. cookies, set_cookie, and remove_cookie read and write ' +
      'the cookie store for any domain. Prefer this over embedded_browser.page fetch unless the request ' +
      'must run inside the page\'s own JavaScript context. Results are JSON.',
    actions: [fetchAction(sessions), cookiesAction(sessions), setCookieAction(sessions), removeCookieAction(sessions)]
  })
}

function fetchAction(sessions: SessionHostProvider): ToolAction {
  return {
    action: 'fetch',
    description:
      'Request a URL on the session: cookies included, no CORS, redirects followed unless redirect is ' +
      'manual. Returns status, response headers, and the body (JSON is shrunk structurally when it ' +
      'exceeds max_chars; binary comes back as base64 with its byte length).',
    inputSchema: objectSchema({
      url: urlField,
      method: methodField,
      headers: headersField,
      body: bodyField,
      redirect: { type: 'string', enum: ['follow', 'manual'], description: 'Follow redirects (default) or stop at the first.' },
      max_chars: { type: 'integer', minimum: 200, maximum: MAX_BODY_CHARS, description: `Body text limit; default ${DEFAULT_BODY_CHARS}.` }
    }, ['url']),
    timeoutMs: FETCH_TIMEOUT_MS,
    run: async (input) => {
      const response = await requireSession(sessions).fetch({
        url: stringArg(input, 'url')!,
        method: stringArg(input, 'method', 'GET')!,
        headers: headersFrom(input),
        body: stringArg(input, 'body'),
        redirect: stringArg(input, 'redirect') as 'follow' | 'manual' | undefined
      })
      const maxChars = numberArg(input, 'max_chars', DEFAULT_BODY_CHARS)
      const { text, ...rest } = response
      if (text === null) return jsonResult({ ...rest, binary: true, base64: rest.base64 && rest.base64.length > maxChars ? rest.base64.slice(0, maxChars) : rest.base64 })
      const { json, isJson } = parseBody(text, response.contentType)
      const bounded = truncateText(text, maxChars, 'Raise max_chars or use embedded_browser.page extract with a path and fields.')
      return jsonResult({
        ...rest,
        base64: null,
        isJson,
        bodyTruncated: bounded.truncated || response.truncated,
        ...(isJson && !bounded.truncated ? { json } : { text: bounded.text })
      })
    }
  }
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

function headersFrom(input: JsonObject): Record<string, string> | undefined {
  const raw = input.headers
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('`headers` must be an object')
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) headers[name] = String(value)
  return headers
}
