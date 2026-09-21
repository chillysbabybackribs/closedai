import type { Session } from 'electron'
import type { BrowserCookieImportResult } from '../shared/security.js'
import { discoverSources, importCookies, type BrowserSource, type ImportResult } from './import-cookies.js'

export type CookieImportDeps = {
  /** The one-shot latch in app-settings.json. */
  latch: { get(): { browserCookiesImported: boolean }; set(patch: { browserCookiesImported: boolean }): Promise<unknown> }
  /** Settings → Security `importBrowserCookies`; only the launch import honors it. */
  enabled: () => boolean
  /** The persist:browser session the cookies land in. */
  target: () => Session
  sources?: () => BrowserSource[]
  run?: (source: BrowserSource, target: Session) => Promise<ImportResult>
}

// One-shot clone of the user's real browser session (cookies) into persist:browser, so the
// embedded browser starts signed in where the user already is. Latched in settings, but an
// empty session with the latch set means a lost import, so re-run it in that case.
export async function importDefaultBrowserCookies(deps: CookieImportDeps): Promise<void> {
  if (!deps.enabled()) {
    console.log('[cookie-import] disabled in Settings → Security; skipping')
    return
  }
  if (deps.latch.get().browserCookiesImported) {
    try {
      const existing = await deps.target().cookies.get({})
      if (existing.length > 0) return
      console.warn('[cookie-import] latch set but session is empty; re-importing')
    } catch {
      // Reading cookies failed — fall through and attempt a fresh import.
    }
  }
  const chosen = (deps.sources ?? discoverSources)()[0]
  if (!chosen) {
    console.warn('[cookie-import] no supported browser profile found; skipping')
    return
  }
  try {
    const result = await runImport(deps, chosen)
    console.log(`[cookie-import] imported ${result.imported} cookies from ${result.source} (${result.failed} failed, ${result.skipped} skipped)`)
  } catch (error) {
    // Do not latch on failure — retry on the next launch.
    console.warn('[cookie-import] failed:', error instanceof Error ? error.message : error)
  }
}

/** Settings → Security "Import now": ignores the latch and the switch; a failure is reported, not logged away. */
export async function importBrowserCookiesNow(deps: CookieImportDeps): Promise<BrowserCookieImportResult> {
  const chosen = (deps.sources ?? discoverSources)()[0]
  if (!chosen) return { source: null, imported: 0, failed: 0, skipped: 0 }
  return runImport(deps, chosen)
}

async function runImport(deps: CookieImportDeps, source: BrowserSource): Promise<ImportResult> {
  const target = deps.target()
  const result = await (deps.run ?? importCookies)(source, target)
  await target.cookies.flushStore()
  await deps.latch.set({ browserCookiesImported: true })
  return result
}
