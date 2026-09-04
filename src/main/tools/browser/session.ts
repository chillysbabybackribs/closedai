import { defineActionTool, type ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { booleanArg, failureResult, numberArg, stringArg, type JsonObject, type ToolDefinition } from '../tool.js'
import { truncateText } from '../truncate-json.js'
import { bodyField, FETCH_TIMEOUT_MS, headersField, methodField, parseBody } from './fetch.js'
import { requireSession, type SessionHostProvider } from './network-host.js'
import { projectJson } from './project.js'

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
    deferLoading: true,
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
      'manual. Returns status, response headers, and the body. For a large JSON response name ' +
      'json_path, fields, and limit to project it — the projection happens before the result is ' +
      'serialised, so only what you asked for costs anything. Binary comes back as base64 with its byte length.',
    inputSchema: objectSchema({
      url: urlField,
      method: methodField,
      headers: headersField,
      body: bodyField,
      redirect: { type: 'string', enum: ['follow', 'manual'], description: 'Follow redirects (default) or stop at the first.' },
      json_path: { type: 'string', minLength: 1, description: 'Dot/bracket path into a JSON response, for example `data.items` or `results[0].rows`. Defaults to the whole document.' },
      fields: { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1 }, description: 'Field paths kept from each item, for example ["name","owner.login"]. Every field when omitted.' },
      limit: { type: 'integer', minimum: 1, description: 'Maximum items returned when the selection is an array.' },
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
      const path = stringArg(input, 'json_path')
      const fields = fieldsFrom(input)
      const limit = input.limit === undefined ? undefined : numberArg(input, 'limit', 0)
      // A projection is the answer to a large JSON body, so apply it before anything is bounded:
      // truncation of a whole document can leave nothing but a note, which helps no one.
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
      const advice = isJson
        ? 'Raise max_chars, or name json_path, fields, and limit to project only what you need.'
        : 'Raise max_chars to see more of this response.'
      const bounded = truncateText(text, maxChars, advice)
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
