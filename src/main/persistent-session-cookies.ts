import type { Session } from 'electron'

// Chrome caps cookie lifetime at 400 days. Renewing promoted session cookies whenever
// the app starts keeps browser-style sessions durable without inventing a plaintext
// cookie export alongside Chromium's own protected cookie database.
export const SESSION_COOKIE_RETENTION_SECONDS = 400 * 24 * 60 * 60

export function toPersistentCookieDetails(
  cookie: Electron.Cookie,
  nowSeconds = Date.now() / 1000
): Electron.CookiesSetDetails | null {
  if (!cookie.domain) return null

  const host = cookie.domain.replace(/^\./, '')
  const path = cookie.path || '/'
  const details: Electron.CookiesSetDetails = {
    url: `${cookie.secure ? 'https' : 'http'}://${host}${path}`,
    name: cookie.name,
    value: cookie.value,
    path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: Math.floor(nowSeconds) + SESSION_COOKIE_RETENTION_SECONDS
  }

  // Omitting domain is what preserves a host-only cookie. Domain cookies retain their
  // original leading-dot scope.
  if (!cookie.hostOnly) details.domain = cookie.domain
  return details
}

export class PersistentSessionCookies {
  private writes: Promise<void> = Promise.resolve()
  private started = false

  constructor(private readonly browserSession: Session) {}

  start(): Promise<void> {
    if (this.started) return this.writes
    this.started = true
    this.browserSession.cookies.on('changed', this.onCookieChanged)

    this.writes = this.writes.then(async () => {
      const sessionCookies = await this.browserSession.cookies.get({ session: true })
      await this.promote(sessionCookies)
    })
    return this.writes
  }

  async flush(): Promise<void> {
    await this.writes
    await this.browserSession.cookies.flushStore()
    await this.browserSession.flushStorageData()
  }

  dispose(): void {
    if (!this.started) return
    this.started = false
    this.browserSession.cookies.off('changed', this.onCookieChanged)
  }

  private readonly onCookieChanged = (
    _event: Electron.Event,
    cookie: Electron.Cookie,
    _cause: string,
    removed: boolean
  ): void => {
    if (removed || !cookie.session) return
    this.writes = this.writes.then(async () => {
      await this.promote([cookie])
    })
  }

  private async promote(cookies: Electron.Cookie[]): Promise<void> {
    const detailsToSet = cookies
      .map((cookie) => toPersistentCookieDetails(cookie))
      .filter((details) => details !== null) as Electron.CookiesSetDetails[]

    if (detailsToSet.length > 0) {
      await Promise.all(detailsToSet.map((details) => this.browserSession.cookies.set(details)))
      await this.browserSession.cookies.flushStore()
    }
  }
}
