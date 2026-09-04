// The colour a browser view shows when it has no page frame to show.
//
// A WebContentsView fills its bounds with one flat base colour in every gap where the page
// is not painting: between a navigation committing and the new document's first paint, when
// a hidden view is shown again, and across attach/detach and resize. Electron applies that
// same colour as the PAGE's base background, so it is also what a site that paints nothing
// on html/body renders as — which is why the browser default is white, the colour every such
// site is written against.
//
// A fixed white is wrong for this app in both directions. Against dark app chrome every gap
// reads as a flash, and the pages people actually look at are frequently dark themselves: a
// new tab onto a dark-mode Google measured 250ms of full white before the page painted. So
// the colour is not fixed. Each load measures the page's real canvas colour and remembers it
// per origin, and the next gap on that origin is filled with the colour the page is about to
// paint. A gap the same colour as the page is not a flash at all.
//
// The invariant every caller maintains: the base colour always matches what is on screen now,
// or what is about to be. Everything else here follows from it.

/** The app's own page bezel (`.browser-view-host`). Shown while a tab holds no document. */
export const CHROME_BASE_COLOR = '#1c1c1d'
/** What a page that paints no background of its own is written against. */
export const DEFAULT_PAGE_BASE_COLOR = '#ffffff'

// Origins are cheap to keep and only ever hold a colour string, but the map must not grow
// without bound across a long session of link-following.
const MAX_REMEMBERED_ORIGINS = 300

/**
 * Reads the page's canvas colour. CSS propagates `html`'s background to the canvas, and only
 * falls back to `body`'s when `html` paints nothing — so the two are read in that order and
 * the first opaque one wins.
 */
export const PAGE_BACKGROUND_PROBE = `(() => {
  const view = document.defaultView
  if (!view || !document.documentElement) return null
  const root = view.getComputedStyle(document.documentElement).backgroundColor
  const body = document.body ? view.getComputedStyle(document.body).backgroundColor : null
  return { root, body }
})()`

export type PageBackgroundProbe = { root?: unknown; body?: unknown }

/**
 * The opaque colour a probe result names, as `#rrggbb`, or null when the page paints nothing.
 *
 * Anything less than fully opaque is deliberately "unknown" rather than a colour: a
 * translucent canvas composites over the base colour, so it does not tell us what the gap
 * should be filled with, and guessing would show the wrong colour with confidence.
 */
export function pageBackgroundColor(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const probe = value as PageBackgroundProbe
  return normalizeCssColor(probe.root) ?? normalizeCssColor(probe.body)
}

/** `rgb()`/`rgba()`/hex as Chromium reports it, normalized to `#rrggbb`; null if not opaque. */
export function normalizeCssColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  const functional = text.match(/^rgba?\(([^)]*)\)$/)
  if (functional) {
    const parts = functional[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return null
    const channels = parts.slice(0, 3).map((part) => Number.parseFloat(part))
    if (channels.some((channel) => !Number.isFinite(channel))) return null
    if (parts.length > 3 && !isOpaqueAlpha(parts[3])) return null
    return hex(channels)
  }
  const hexadecimal = text.match(/^#([0-9a-f]{3,8})$/)
  if (!hexadecimal) return null
  const digits = hexadecimal[1]
  if (digits.length === 3 || digits.length === 4) {
    if (digits.length === 4 && digits[3] !== 'f') return null
    return `#${digits.slice(0, 3).split('').map((digit) => digit + digit).join('')}`
  }
  if (digits.length === 6) return `#${digits}`
  if (digits.length === 8) return digits.slice(6) === 'ff' ? `#${digits.slice(0, 6)}` : null
  return null
}

/** The key a colour is remembered under: one colour per site, or null for un-keyable URLs. */
export function pageBackgroundOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

/**
 * What each site last painted, so a gap can be filled before the page has painted anything.
 *
 * Shared across every tab in a window: the colour belongs to the site, not to the view that
 * happened to load it, so a brand-new tab onto a site another tab already visited starts at
 * the right colour on its first frame.
 */
export class PageBackgroundMemory {
  private readonly colors = new Map<string, string>()

  recall(url: string): string | null {
    const origin = pageBackgroundOrigin(url)
    if (!origin) return null
    const color = this.colors.get(origin)
    if (!color) return null
    // Re-insert so the entries evicted below are genuinely the least recently useful ones.
    this.colors.delete(origin)
    this.colors.set(origin, color)
    return color
  }

  remember(url: string, color: string): void {
    const origin = pageBackgroundOrigin(url)
    if (!origin) return
    this.colors.delete(origin)
    this.colors.set(origin, color)
    if (this.colors.size <= MAX_REMEMBERED_ORIGINS) return
    const oldest = this.colors.keys().next()
    if (!oldest.done) this.colors.delete(oldest.value)
  }

  /** Test/diagnostic view of how many sites are remembered. */
  get size(): number {
    return this.colors.size
  }
}

function isOpaqueAlpha(part: string): boolean {
  const alpha = part.endsWith('%') ? Number.parseFloat(part) / 100 : Number.parseFloat(part)
  return Number.isFinite(alpha) && alpha >= 1
}

function hex(channels: number[]): string {
  return `#${channels.map((channel) => {
    const clamped = Math.max(0, Math.min(255, Math.round(channel)))
    return clamped.toString(16).padStart(2, '0')
  }).join('')}`
}
