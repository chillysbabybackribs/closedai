// Cookies as data, straight from the session store: any domain, any tab, no page context.

export type CookieRecord = {
  name: string
  value: string
  domain: string | null
  path: string | null
  secure: boolean
  httpOnly: boolean
  session: boolean
  expiresAt: string | null
  sameSite: string | null
}

export type CookieFilter = {
  url?: string
  domain?: string
  name?: string
  limit: number
}

export type CookieInput = {
  name: string
  value: string
  url?: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  /** Seconds since the epoch; omitted means a session cookie. */
  expiresAt?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/** The subset of Electron's Cookies API the tools use; tests pass a fake. */
export type CookieStore = {
  get(filter: Electron.CookiesGetFilter): Promise<Electron.Cookie[]>
  set(details: Electron.CookiesSetDetails): Promise<void>
  remove(url: string, name: string): Promise<void>
}

export async function listCookies(store: CookieStore, filter: CookieFilter): Promise<{ matched: number; cookies: CookieRecord[] }> {
  const query: Electron.CookiesGetFilter = {}
  if (filter.url) query.url = filter.url
  if (filter.domain) query.domain = filter.domain
  if (filter.name) query.name = filter.name
  const cookies = await store.get(query)
  return { matched: cookies.length, cookies: cookies.slice(0, filter.limit).map(publicCookie) }
}

export async function setCookie(store: CookieStore, input: CookieInput): Promise<CookieRecord> {
  const url = input.url ?? urlForCookie(input.domain, input.path, input.secure)
  if (!url) throw new Error('set_cookie needs `url` or `domain`')
  const details: Electron.CookiesSetDetails = { url, name: input.name, value: input.value }
  if (input.domain) details.domain = input.domain
  if (input.path) details.path = input.path
  if (input.secure !== undefined) details.secure = input.secure
  if (input.httpOnly !== undefined) details.httpOnly = input.httpOnly
  if (input.expiresAt !== undefined) details.expirationDate = input.expiresAt
  if (input.sameSite) details.sameSite = input.sameSite
  await store.set(details)
  const written = await store.get({ url, name: input.name })
  const match = written.find((cookie) => cookie.name === input.name) ?? written[0]
  if (!match) throw new Error(`The session rejected cookie ${input.name} for ${url}`)
  return publicCookie(match)
}

export async function removeCookie(store: CookieStore, input: { url?: string; domain?: string; name: string }): Promise<{ removed: number }> {
  const url = input.url ?? urlForCookie(input.domain, undefined, undefined)
  if (!url) throw new Error('remove_cookie needs `url` or `domain`')
  const before = await store.get({ url, name: input.name })
  if (before.length === 0) return { removed: 0 }
  await store.remove(url, input.name)
  return { removed: before.length }
}

/** Electron addresses cookies by URL; derive one from a bare domain the way a browser would. */
export function urlForCookie(domain: string | undefined, path: string | undefined, secure: boolean | undefined): string | null {
  if (!domain) return null
  const host = domain.replace(/^\./, '')
  const scheme = secure === false ? 'http' : 'https'
  return `${scheme}://${host}${path && path.startsWith('/') ? path : '/'}`
}

function publicCookie(cookie: Electron.Cookie): CookieRecord {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? null,
    path: cookie.path ?? null,
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    session: cookie.session ?? cookie.expirationDate === undefined,
    expiresAt: cookie.expirationDate === undefined ? null : new Date(cookie.expirationDate * 1000).toISOString(),
    sameSite: cookie.sameSite ?? null
  }
}
