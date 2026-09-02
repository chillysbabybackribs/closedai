// Shared browser session partition. All tabs and OAuth popups use this one persistent
// partition so a login in any surface applies everywhere. Lives here (a dependency-free
// module) so both the tab and the popup policy can import it without a cycle.
export const PARTITION = 'persist:browser'



// The new-tab landing page.
export const HOME_URL = 'https://www.google.com'
// Where omnibox free-text (not a URL) is searched. Kept separate from HOME_URL so the
// landing page and the search engine can diverge without touching query routing; `?q=`
// is the search param Google, Bing, and DuckDuckGo all accept.
export const SEARCH_URL = 'https://www.google.com/search'

export function normalizeUrl(input: string, baseUrl = HOME_URL): string {
  const trimmed = input.trim()
  if (!trimmed) return 'about:blank'
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed
  if (/^(?:\/|\?|#|\.\.?\/)/.test(trimmed)) {
    try { return new URL(trimmed, baseUrl).toString() } catch { /* fall through to search */ }
  }
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(trimmed)) return `https://${trimmed}`
  return `${SEARCH_URL}?q=${encodeURIComponent(trimmed)}`
}

/**
 * Whether two URLs name the same loaded document — the "is this tab already showing
 * that page" question browser_navigate asks before reloading (browser-navigate-tool.ts).
 *
 * A reload destroys scroll position and un-submitted form input, so equality here is
 * deliberately generous where a reload buys nothing: fragments are ignored (an in-page
 * jump needs no load), and `/` vs empty path are the same root. Query strings and any
 * deeper path difference are REAL navigations and stay unequal — under-matching costs
 * one avoidable reload, over-matching silently shows the model the wrong page.
 */
export function sameDocumentUrl(a: string, b: string): boolean {
  try {
    const left = new URL(a)
    const right = new URL(b)
    const path = (u: URL): string => (u.pathname === '/' ? '' : u.pathname)
    return (
      left.protocol === right.protocol &&
      left.hostname.toLowerCase() === right.hostname.toLowerCase() &&
      left.port === right.port &&
      path(left) === path(right) &&
      left.search === right.search
    )
  } catch {
    return false
  }
}

// Chromium derives a cookie's registrable domain from the Public Suffix List, which
// neither Node nor Electron exposes. Two labels is right for the overwhelming majority of
// hosts; this set covers the common multi-part suffixes so `bbc.co.uk` doesn't collapse to
// `co.uk` and drag every unrelated UK site along with it. An unlisted exotic suffix degrades
// to over-scoping, never to a leak — every caller is scoped to one user's own profiles.
const MULTIPART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'ne.jp', 'or.jp', 'com.au', 'net.au',
  'org.au', 'com.br', 'com.cn', 'com.mx', 'com.tr', 'co.in', 'co.nz', 'co.za', 'co.kr',
  'com.sg', 'com.hk', 'com.tw', 'co.il', 'com.ar', 'co.th', 'com.pl', 'com.ua'
])

/** eTLD+1 for a hostname, or null when it can hold no shareable domain cookie. */
export function registrableDomain(host: string): string | null {
  const h = host.replace(/^\./, '').replace(/\.$/, '').toLowerCase()
  // Bare IPs and single-label hosts like `localhost` only ever carry host-only cookies,
  // so there is no registrable domain to scope to.
  if (!h || h.includes(':') || /^\d+(?:\.\d+){3}$/.test(h)) return null
  const parts = h.split('.')
  if (parts.length < 2) return null
  const twoLabel = parts.slice(-2).join('.')
  if (!MULTIPART_SUFFIXES.has(twoLabel)) return twoLabel
  return parts.length >= 3 ? parts.slice(-3).join('.') : null
}

// A superseded or cancelled navigation: loadURL rejects with Chromium's ERR_ABORTED
// (errno -3) whenever one load is replaced by another or the tab closes mid-load.
export function isAbortedNavigation(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: string }).code
  if (code === 'ERR_ABORTED') return true
  // Electron formats the message as "<errorDescription> (<errno>) loading '<url>'". Usually
  // that description is "ERR_ABORTED", but live testing showed it can be EMPTY — leaving just
  // " (-3) loading '<url>'". The errno -3 IS ERR_ABORTED, so recognize that form too: match
  // "(-3)" only when followed by " loading '", so a URL that merely contains "(-3)" cannot be
  // misclassified as an abort.
  return error.message.startsWith('ERR_ABORTED') || /\(-3\) loading '/.test(error.message)
}
