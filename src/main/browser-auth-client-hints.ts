import type { Session } from 'electron'

// Google sign-in bounces through these hosts. Keep the rewrite narrowly scoped
// so other sites retain Chromium's native Client Hints.
const googleAuthHostSuffixes = [
  'accounts.google.com',
  'accounts.youtube.com',
  'accounts.gstatic.com',
  'oauthaccountmanager.googleapis.com'
] as const

export function isGoogleAuthHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '')
  return googleAuthHostSuffixes.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
  )
}

export function isGoogleAuthUrl(rawUrl: string): boolean {
  try {
    return isGoogleAuthHost(new URL(rawUrl).hostname)
  } catch {
    return false
  }
}

export function chromiumMajorVersion(userAgent: string): number | null {
  const match = /Chrome\/(\d+)\./.exec(userAgent)
  if (!match) return null
  const major = Number.parseInt(match[1]!, 10)
  return Number.isInteger(major) && major > 0 ? major : null
}

type ClientHintHeaders = {
  'sec-ch-ua': string
  'sec-ch-ua-full-version-list'?: string
}

export function googleAuthClientHints(majorVersion: number, fullVersion?: string): ClientHintHeaders {
  const major = String(majorVersion)
  const hints: ClientHintHeaders = {
    'sec-ch-ua': [
      `"Google Chrome";v="${major}"`,
      `"Chromium";v="${major}"`,
      '"Not/A)Brand";v="24"'
    ].join(', ')
  }
  if (fullVersion && /^\d+(?:\.\d+){0,3}$/.test(fullVersion)) {
    hints['sec-ch-ua-full-version-list'] = [
      `"Google Chrome";v="${fullVersion}"`,
      `"Chromium";v="${fullVersion}"`,
      '"Not/A)Brand";v="24.0.0.0"'
    ].join(', ')
  }
  return hints
}

function chromiumFullVersion(userAgent: string): string | null {
  const match = /Chrome\/(\d+(?:\.\d+){0,3})/.exec(userAgent)
  return match?.[1] ?? null
}

export function rewriteRequestClientHints(
  headers: Record<string, string | string[]>,
  hints: ClientHintHeaders
): boolean {
  let changed = false
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase()
    if (lower === 'sec-ch-ua') {
      headers[key] = hints['sec-ch-ua']
      changed = true
    } else if (lower === 'sec-ch-ua-full-version-list' && hints['sec-ch-ua-full-version-list']) {
      headers[key] = hints['sec-ch-ua-full-version-list']
      changed = true
    }
  }
  return changed
}

export function forceGoogleClientHints(
  headers: Record<string, string | string[]>,
  hints: ClientHintHeaders
): boolean {
  let changed = false
  let sawUa = false
  let sawFull = false
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase()
    if (lower === 'sec-ch-ua') {
      headers[key] = hints['sec-ch-ua']
      sawUa = true
      changed = true
    } else if (lower === 'sec-ch-ua-full-version-list' && hints['sec-ch-ua-full-version-list']) {
      headers[key] = hints['sec-ch-ua-full-version-list']
      sawFull = true
      changed = true
    }
  }
  if (!sawUa) {
    headers['Sec-CH-UA'] = hints['sec-ch-ua']
    changed = true
  }
  if (!sawFull && hints['sec-ch-ua-full-version-list']) {
    headers['Sec-CH-UA-Full-Version-List'] = hints['sec-ch-ua-full-version-list']
    changed = true
  }
  return changed
}

export function stripEmbedderFromUserAgent(
  headers: Record<string, string | string[]>,
  applicationName?: string
): boolean {
  const token = applicationName?.replace(/[^a-z0-9]/gi, '')
  const patterns = [
    /\sElectron\/\S+/gi,
    ...(token ? [new RegExp(`\\s${escapeRegExp(token)}\\/\\S+`, 'gi')] : [])
  ]
  let changed = false
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== 'user-agent') continue
    const value = Array.isArray(headers[key]) ? headers[key][0] ?? '' : String(headers[key])
    const cleaned = patterns.reduce((current, pattern) => current.replace(pattern, ''), value)
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (cleaned !== value) {
      headers[key] = cleaned
      changed = true
    }
  }
  return changed
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Structured User-Agent Client Hints for CDP Network.setUserAgentOverride. Chromium DERIVES the
// wire Sec-CH-UA* headers and navigator.userAgentData from this metadata, which is why it works
// where an onBeforeSendHeaders rewrite does not: the header hook races Chromium's own Client Hints
// layer and loses, so a forced "Google Chrome" brand gets overwritten back to bare "Chromium" on
// the wire (the exact symptom Google's sign-in blocks). Setting it at the source makes the brand
// authoritative. Brands MUST stay consistent with the UA string's version or the mismatch is itself
// a bot tell. The "Not(A:Brand" GREASE entry is what real Chrome sends.
export type UserAgentMetadata = {
  brands: Array<{ brand: string; version: string }>
  fullVersionList: Array<{ brand: string; version: string }>
  platform: string
  platformVersion: string
  architecture: string
  bitness: string
  model: string
  mobile: boolean
}

export function googleUserAgentMetadata(userAgent: string): UserAgentMetadata | null {
  const major = chromiumMajorVersion(userAgent)
  if (major === null) return null
  const majorStr = String(major)
  const full = chromiumFullVersion(userAgent) ?? `${major}.0.0.0`
  return {
    // Include "Google Chrome" — its absence (bare Chromium) is what Google distrusts.
    brands: [
      { brand: 'Chromium', version: majorStr },
      { brand: 'Google Chrome', version: majorStr },
      { brand: 'Not(A:Brand', version: '99' }
    ],
    fullVersionList: [
      { brand: 'Chromium', version: full },
      { brand: 'Google Chrome', version: full },
      { brand: 'Not(A:Brand', version: '99.0.0.0' }
    ],
    // Truthful platform: it must agree with the UA string and WebGL, or we trade one tell for another.
    platform: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
    platformVersion: process.platform === 'win32' ? '10.0.0' : '',
    architecture: 'x86',
    bitness: '64',
    model: '',
    mobile: false
  }
}

// NOTE: an `installGoogleAuthClientHints` helper used to live here. It registered its OWN
// onBeforeSendHeaders handler, which would silently REPLACE the composed pipeline below
// (Electron keeps exactly one per session). It had zero callers and was deleted during
// Pillar 2; auth-host Client Hints are handled at the CDP layer (see below and browser-tab.ts).

/**
 * Normalize only the User-Agent wire token here. Client Hints are set authoritatively at the CDP
 * layer (Network.setUserAgentOverride in browser-tab.ts) — Chromium derives Sec-CH-UA* from that,
 * and a SECOND source setting them here only creates a short-vs-full-version-list GREASE-brand
 * mismatch (this hook used "Not/A)Brand";v="24"; the CDP override uses "Not(A:Brand";v="99"), which
 * is itself a bot tell. So this hook now does one thing: strip the Electron/app product token that
 * Chromium may keep on individual request UAs even after app.userAgentFallback is changed.
 */
// The single outbound-header handler for the session. Electron allows exactly ONE
// onBeforeSendHeaders listener per session — a second call silently REPLACES the first — so
// every request-header mutation must compose here rather than register its own handler.
// Stage 1 strips the embedder token (identity); stage 2 is the optional vault injector
// (Pillar 1 wire-level auth). The injector is wrapped so a throw can never break a request.
export function installRequestHeaderPipeline(
  browserSession: Session,
  applicationName?: string,
  injectHeaders?: (url: string, headers: Record<string, string | string[]>) => void
): void {
  browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    stripEmbedderFromUserAgent(details.requestHeaders, applicationName)
    if (injectHeaders) {
      try {
        injectHeaders(details.url, details.requestHeaders)
      } catch {
        // A vault fault must degrade to "no injection", never to a stalled request.
      }
    }
    callback({ requestHeaders: details.requestHeaders })
  })
}
