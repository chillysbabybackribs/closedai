/**
 * cookie-refresh.ts — repair ONE site's session in the embedded browser.
 *
 * `importDefaultBrowserCookies` (index.ts) clones the user's real browser session into
 * `persist:browser` exactly once per profile, and that latch is correct: re-running it
 * wholesale on every launch would clobber fresher logins made inside closedai itself.
 *
 * The cost of the latch is this module's reason to exist. Any site the user signs into
 * in their real browser *after* closedai's first launch never arrives, so the embedded
 * browser sits permanently signed out on it with no way back — the import already
 * "happened". This is the scoped escape hatch: one registrable domain at a time, so
 * repairing Facebook cannot disturb the Google or GitHub sessions sitting beside it.
 *
 * Kept out of import-cookies.ts so that module stays what it says it is — the decrypt
 * and bulk-clone primitive — while the per-site repair policy lives on its own.
 */

import type { Session } from 'electron'
import { discoverSources, importCookies, type BrowserSource, type ImportResult } from './import-cookies.js'
import { registrableDomain } from './browser-url.js'

/** What a per-site cookie re-import would act on: the domain, and the browser it reads. */
export function cookieImportTargetFor(
  pageUrl: string
): { domain: string; source: BrowserSource } | null {
  let host: string
  try {
    const parsed = new URL(pageUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    host = parsed.hostname
  } catch {
    return null // about:blank, the new-tab page, a malformed URL
  }
  const domain = registrableDomain(host)
  if (!domain) return null
  const source = discoverSources()[0]
  return source ? { domain, source } : null
}

export interface RefreshResult extends ImportResult {
  domain: string
  removed: number
}

/** Re-clone one site's cookies from the real browser into `targetSession`. */
export async function refreshCookiesForUrl(
  targetSession: Session,
  pageUrl: string
): Promise<RefreshResult | null> {
  const target = cookieImportTargetFor(pageUrl)
  if (!target) return null
  const { domain, source } = target

  // Clear the site's existing cookies before importing. A partial overlay is the failure
  // mode that looks like success but isn't: a logged-out marker minted inside closedai (or
  // a device cookie the source browser has since rotated) survives next to the freshly
  // imported session pair, and the site rejects the mismatched combination.
  let removed = 0
  for (const cookie of await targetSession.cookies.get({ domain })) {
    const host = (cookie.domain ?? domain).replace(/^\./, '')
    const url = `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`
    try {
      await targetSession.cookies.remove(url, cookie.name)
      removed++
    } catch {
      /* best-effort: a cookie we cannot address is one the import will overwrite anyway */
    }
  }

  const result = await importCookies(source, targetSession, { domains: [domain] })
  await targetSession.cookies.flushStore()
  return { ...result, domain, removed }
}
