/**
 * import-cookies.ts — clone the user's real browser session into closedai.
 *
 * Rather than fight Google's embedded-browser fingerprint detection, we import
 * the cookies the user's actual Chrome/Brave/Chromium already holds. Those
 * sessions were minted in a real browser, so trust surfaces (Google, GitHub)
 * already accept them — the fingerprint question never comes up. Ported from
 * the chromeTerm project, which validated the approach against live Google auth.
 *
 * Linux specifics (verified on this machine):
 *  - Cookies live in a SQLite DB at <profile>/Default/Cookies.
 *  - Values are `v11`-prefixed AES-128-CBC, key = PBKDF2-HMAC-SHA1(secret,
 *    'saltysalt', 1 iter, 16 bytes), IV = 16 spaces. `v10` uses the same KDF
 *    with the fixed fallback secret 'peanuts'.
 *  - The `secret` is the keyring item labeled "<Browser> Safe Storage", read via
 *    `secret-tool lookup application <app>` — used RAW (not base64-decoded).
 *  - Chrome v24+ prepends 32 bytes of SHA256(host_key) to each plaintext value;
 *    we verify and strip it (the match also confirms the key is correct).
 *
 * Deps: node:crypto (stdlib) + two CLIs already on the system — `secret-tool`
 * (keyring secret) and `sqlite3` (read the Cookies DB). We shell out to `sqlite3`
 * because Electron's bundled Node has no lock-safe pure-JS cookie reader in
 * stdlib. No native modules, no npm deps. macOS/Windows key retrieval differ
 * (Keychain / DPAPI) and are left as clearly-marked TODOs.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createDecipheriv, pbkdf2Sync, createHash } from 'node:crypto'
import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import type { Session } from 'electron'

const execFileP = promisify(execFile)
const IV = Buffer.alloc(16, ' ')
const FIXED_FALLBACK_SECRET = 'peanuts' // v10 key when no keyring is present

export interface BrowserSource {
  id: string
  name: string
  /** app attribute passed to `secret-tool lookup application <app>` */
  keyringApp: string
  cookiesPath: string
}

/**
 * Discover installed Chromium-family browsers with a cookie store, on Linux.
 *
 * Every profile is a source, not just Default: a user whose daily driver is
 * "Profile 1" has a Default profile that still exists but holds dead sessions,
 * and a sync that can only read Default will confidently import those corpses
 * (measured live 2026-08-12: Chrome Default's pinterest cookies were 14 days
 * dead while the user's real session lived elsewhere). Default stays first so
 * callers that take sources[0] keep their old behavior.
 */
export function discoverSources(): BrowserSource[] {
  const home = homedir()
  const candidates: Array<Omit<BrowserSource, 'cookiesPath'> & { dir: string }> = [
    { id: 'chrome', name: 'Google Chrome', keyringApp: 'chrome', dir: '.config/google-chrome' },
    { id: 'brave', name: 'Brave', keyringApp: 'brave', dir: '.config/BraveSoftware/Brave-Browser' },
    { id: 'chromium', name: 'Chromium', keyringApp: 'chromium', dir: '.config/chromium' },
    { id: 'edge', name: 'Microsoft Edge', keyringApp: 'microsoft-edge', dir: '.config/microsoft-edge' }
  ]
  const found: BrowserSource[] = []
  for (const c of candidates) {
    const profiles = ['Default']
    try {
      for (const entry of readdirSync(join(home, c.dir))) {
        if (/^Profile \d+$/.test(entry)) profiles.push(entry)
      }
    } catch {
      /* browser not installed — the existsSync below handles it */
    }
    for (const profile of profiles) {
      const cookiesPath = join(home, c.dir, profile, 'Cookies')
      if (existsSync(cookiesPath)) {
        found.push({
          id: profile === 'Default' ? c.id : `${c.id}:${profile.toLowerCase().replace(/ /g, '-')}`,
          name: profile === 'Default' ? c.name : `${c.name} (${profile})`,
          keyringApp: c.keyringApp,
          cookiesPath
        })
      }
    }
  }
  return found
}

/** Read the browser's keyring Safe-Storage secret (raw bytes). */
async function keyringSecret(keyringApp: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileP('secret-tool', ['lookup', 'application', keyringApp], {
      encoding: 'buffer'
    })
    const buf = stdout as unknown as Buffer
    // Trim a single trailing newline if the tool added one.
    return buf.length && buf[buf.length - 1] === 0x0a ? buf.subarray(0, buf.length - 1) : buf
  } catch {
    return null // no keyring / locked → fall back to the v10 fixed key
  }
}

function deriveKey(secret: Buffer): Buffer {
  return pbkdf2Sync(secret, 'saltysalt', 1, 16, 'sha1')
}

function decryptValue(enc: Buffer, hostKey: string, v11Key: Buffer, v10Key: Buffer): string | null {
  if (enc.length < 3) return enc.toString('utf8') // unencrypted (rare, old)
  const tag = enc.subarray(0, 3).toString('latin1')
  const key = tag === 'v11' ? v11Key : tag === 'v10' ? v10Key : null
  if (!key) return null
  try {
    const d = createDecipheriv('aes-128-cbc', key, IV)
    d.setAutoPadding(false)
    let out = Buffer.concat([d.update(enc.subarray(3)), d.final()])
    const pad = out[out.length - 1]
    if (pad > 0 && pad <= 16) out = out.subarray(0, out.length - pad)
    if (out.length >= 32) {
      const h = createHash('sha256').update(hostKey).digest()
      if (out.subarray(0, 32).equals(h)) out = out.subarray(32)
    }
    return out.toString('utf8')
  } catch {
    return null
  }
}

interface CookieRow {
  host_key: string
  name: string
  encrypted_value: Buffer
  path: string
  expires_utc: number
  is_secure: number
  is_httponly: number
  samesite: number
}

/**
 * Read the cookie rows via the `sqlite3` CLI. `encrypted_value` is a BLOB, so we
 * SELECT it as hex(...) to survive the text pipe, then rebuild the Buffer. Rows
 * are emitted one JSON object per line (sqlite3 -json would buffer the whole set
 * and choke on the binary; line-mode with explicit separators is robust).
 */
async function readCookieRows(dbPath: string): Promise<CookieRow[]> {
  const sql = `
    SELECT host_key, name, hex(encrypted_value), path, expires_utc,
           is_secure, is_httponly, samesite
    FROM cookies;`
  // -separator/-newline with .mode list gives us a clean, unambiguous delimiter
  // set that won't collide with cookie contents (US/RS control chars).
  const US = '\x1f' // unit separator between fields
  const RS = '\x1e' // record separator between rows
  const { stdout } = await execFileP(
    'sqlite3',
    ['-batch', '-noheader', '-separator', US, '-newline', RS, dbPath, sql],
    { maxBuffer: 256 * 1024 * 1024 }
  )
  const rows: CookieRow[] = []
  for (const rec of stdout.split(RS)) {
    if (!rec) continue
    const f = rec.split(US)
    if (f.length < 8) continue
    rows.push({
      host_key: f[0],
      name: f[1],
      encrypted_value: Buffer.from(f[2], 'hex'),
      path: f[3],
      expires_utc: Number(f[4]),
      is_secure: Number(f[5]),
      is_httponly: Number(f[6]),
      samesite: Number(f[7])
    })
  }
  return rows
}

/** Chrome stores expiry as microseconds since 1601-01-01; Electron wants unix seconds. */
function chromeTimeToUnix(chromeUtc: number): number | undefined {
  if (!chromeUtc) return undefined // session cookie
  const WEBKIT_EPOCH_DIFF = 11644473600 // seconds between 1601 and 1970
  return Math.floor(chromeUtc / 1_000_000 - WEBKIT_EPOCH_DIFF)
}

function sameSiteFor(n: number): 'no_restriction' | 'lax' | 'strict' {
  // Chrome: -1 unspecified, 0 none, 1 lax, 2 strict.
  return n === 2 ? 'strict' : n === 0 ? 'no_restriction' : 'lax'
}

export interface ImportResult {
  source: string
  imported: number
  failed: number
  skipped: number
}

/**
 * Decrypt the source browser's cookies and inject them into an Electron session.
 * Optionally filter to specific eTLD+1 domains (e.g. ['google.com','github.com']).
 */
export async function importCookies(
  source: BrowserSource,
  targetSession: Session,
  opts: { domains?: string[] } = {}
): Promise<ImportResult> {
  const secret = await keyringSecret(source.keyringApp)
  const v11Key = deriveKey(secret ?? Buffer.from(FIXED_FALLBACK_SECRET))
  const v10Key = deriveKey(Buffer.from(FIXED_FALLBACK_SECRET))

  // Copy the DB first — Chrome holds a lock on the live file.
  const tmp = join(tmpdir(), `closedai-cookie-import-${source.id}-${process.pid}.db`)
  copyFileSync(source.cookiesPath, tmp)

  let rows: CookieRow[]
  try {
    rows = await readCookieRows(tmp)
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      /* best-effort cleanup */
    }
  }

  // Shares `hostInDomain` with summarizeSourceCookies on purpose: status reports the scope a
  // sync is about to touch, so the two must never be able to disagree about what matches.
  const wanted = opts.domains?.map((d) => d.toLowerCase())
  const matches = (host: string): boolean =>
    !wanted || wanted.some((d) => hostInDomain(host, d))

  let imported = 0
  let failed = 0
  let skipped = 0

  const cookiesToSet: Electron.CookiesSetDetails[] = []

  for (const row of rows) {
    if (!matches(row.host_key)) {
      skipped++
      continue
    }
    const value = decryptValue(row.encrypted_value, row.host_key, v11Key, v10Key)
    if (value === null) {
      failed++
      continue
    }
    // Electron derives the cookie's origin from `url`; build one consistent with
    // the host + secure flag so host-only vs domain cookies land correctly.
    const domain = row.host_key
    const scheme = row.is_secure ? 'https' : 'http'
    const urlHost = domain.startsWith('.') ? domain.slice(1) : domain
    const url = `${scheme}://${urlHost}${row.path || '/'}`

    cookiesToSet.push({
      url,
      name: row.name,
      value,
      // Only set `domain` for domain cookies (leading dot); host-only cookies
      // omit it so Electron scopes them to the exact host.
      domain: domain.startsWith('.') ? domain : undefined,
      path: row.path || '/',
      secure: !!row.is_secure,
      httpOnly: !!row.is_httponly,
      expirationDate: chromeTimeToUnix(row.expires_utc),
      sameSite: sameSiteFor(row.samesite)
    })
  }

  const results = await Promise.allSettled(
    cookiesToSet.map((cookie) => targetSession.cookies.set(cookie))
  )
  results.forEach((result) => {
    if (result.status === 'fulfilled') imported++
    else failed++
  })

  if (cookiesToSet.length > 0) await targetSession.cookies.flushStore()

  return { source: source.name, imported, failed, skipped }
}

/** True when `host` is `domain` itself or a subdomain of it. Leading dots are ignored. */
export function hostInDomain(host: string, domain: string): boolean {
  const h = host.replace(/^\./, '').toLowerCase()
  const d = domain.replace(/^\./, '').toLowerCase()
  return h === d || h.endsWith('.' + d)
}

/** Per-domain cookie counts in a source browser, derived without decrypting anything. */
export interface SourceCookieSummary {
  domain: string
  /** Cookies whose host matches the domain (or a subdomain of it). */
  cookies: number
  /** Of those, cookies with no expiry — they die with the browser session. */
  sessionCookies: number
  /** Of those, cookies whose expiry has already passed. */
  expired: number
  /** Furthest-out expiry as unix seconds, or null when every match is a session cookie. */
  newestExpiry: number | null
}

/**
 * Summarize a source browser's cookies for a set of domains WITHOUT decrypting any value.
 *
 * This is the read half of the session-sync loop: it answers "does the user's real Chrome
 * still hold a live session for this site?" — a question that needs only host and expiry.
 * The `encrypted_value` blob is never SELECTed, so a status call has no decryption path and
 * therefore no way to leak a credential, even accidentally through an error message.
 */
export async function summarizeSourceCookies(
  source: BrowserSource,
  domains: string[]
): Promise<SourceCookieSummary[]> {
  const tmp = join(tmpdir(), `closedai-cookie-status-${source.id}-${process.pid}.db`)
  copyFileSync(source.cookiesPath, tmp)
  let raw: string
  try {
    const { stdout } = await execFileP(
      'sqlite3',
      ['-batch', '-noheader', '-separator', '\x1f', '-newline', '\x1e', tmp,
       'SELECT host_key, expires_utc FROM cookies;'],
      { maxBuffer: 64 * 1024 * 1024 }
    )
    raw = stdout
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      /* best-effort cleanup */
    }
  }

  const nowSec = Math.floor(Date.now() / 1000)
  return domains.map((domain) => {
    let cookies = 0
    let sessionCookies = 0
    let expired = 0
    let newestExpiry: number | null = null
    for (const rec of raw.split('\x1e')) {
      if (!rec) continue
      const f = rec.split('\x1f')
      if (f.length < 2) continue
      if (!hostInDomain(f[0], domain)) continue
      cookies++
      const unix = chromeTimeToUnix(Number(f[1]))
      if (unix === undefined) {
        sessionCookies++
        continue
      }
      if (unix <= nowSec) expired++
      if (newestExpiry === null || unix > newestExpiry) newestExpiry = unix
    }
    return { domain, cookies, sessionCookies, expired, newestExpiry }
  })
}
