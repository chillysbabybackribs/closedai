// THE overlay detector. Every consumer — browser_read_page, page_glance, browser_dismiss_overlay,
// and the ambient overlay-state field on every tab-scoped tool result — imports this file. Before
// it there were three hand-maintained selector lists that had already drifted (dismiss knew
// [role="listbox"], read_page did not, glance knew neither popovers nor z-index), so the same page
// could report three different "topmost overlay" answers depending on which tool the model picked.
//
// Detection is measured, not enumerated. A selector allowlist only ever knows the libraries that
// existed the day someone last edited it, which is exactly why modal handling decayed on a timer:
// every Radix bump or hand-rolled `position:fixed; z-index:9999` div was invisible until a human
// noticed. The three tiers below are ordered by how much they can be trusted:
//
//   top-layer — `:modal` and `:popover-open` are Chromium's own top-layer state. Engine truth.
//   markup    — the union of the old selector lists. Framework dialogs that never enter the top
//               layer still need catching, but this tier can only lag the ecosystem.
//   geometry  — what is ACTUALLY painted over the viewport centre, found by walking up from
//               elementFromPoint. Knows nothing about libraries, so it cannot go stale. Requires a
//               corroborating blocking signal (scroll lock / inert background) before it counts,
//               otherwise fixed SPA shells and sticky chrome would read as modals.

export type BrowserOverlayKindName = 'dialog' | 'modal' | 'popover'
export type BrowserOverlaySource = 'top-layer' | 'markup' | 'geometry'

/** Why the probe judged an overlay blocking. Reported so a wrong verdict stays debuggable. */
export type BrowserOverlaySignal =
  'top-layer' | 'aria-modal' | 'scroll-lock' | 'background-inert' | 'covers-centre'

export type BrowserOverlayObservation = {
  kind: BrowserOverlayKindName
  name: string | null
  /** True when the overlay actually intercepts interaction — not merely present in the DOM. */
  blocking: boolean
  source: BrowserOverlaySource
  rect: { x: number; y: number; width: number; height: number }
  signals: BrowserOverlaySignal[]
}

/**
 * The markup tier, as one exported constant. Anything that needs to recognise dialog markup
 * imports THIS — a fourth private copy is what the single-detector ratchet test exists to catch.
 */
export const OVERLAY_SELECTOR_DEFS: ReadonlyArray<readonly [string, BrowserOverlayKindName]> = [
  ['dialog[open]', 'dialog'],
  ['[role="alertdialog"]', 'dialog'],
  ['[role="dialog"][aria-modal="true"]', 'modal'],
  ['[role="dialog"][data-state="open"]', 'modal'],
  ['.modal.show', 'modal'],
  ['[popover]:popover-open', 'popover'],
  ['[role="menu"][data-state="open"]', 'popover'],
  ['[role="listbox"]', 'popover'],
  ['[data-radix-popper-content-wrapper] [data-state="open"]', 'popover']
]

const SELECTOR_DEFS_JSON = JSON.stringify(OVERLAY_SELECTOR_DEFS)

/**
 * Attribute the probe stamps on the winning element when given a tag value. browser_dismiss_overlay
 * already keyed its close/verify/cleanup scripts off this exact name, so those keep working.
 */
export const OVERLAY_TAG_ATTRIBUTE = 'data-closedai-overlay-token'

// Shared helpers: visibility, document-level scroll lock, and the inert-background test. Kept as a
// separate fragment so the assembling function stays inside the hygiene function-size budget.
const PROBE_HELPERS = `
  const VW = innerWidth || document.documentElement.clientWidth || 0;
  const VH = innerHeight || document.documentElement.clientHeight || 0;
  const vis = (el) => {
    if (!el || el.nodeType !== 1 || el.hidden) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity || 1) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  let scrollLock = false;
  try {
    scrollLock = getComputedStyle(document.body).overflow === 'hidden'
      || getComputedStyle(document.documentElement).overflow === 'hidden';
  } catch (e) {}
  // A modal implementation that hides the rest of the page from assistive tech is telling us
  // plainly that the background is not interactive. Radix, Headless UI and the dialog element's
  // own polyfills all do one of these two.
  const inertBackground = (el) => {
    try {
      for (const child of document.body.children) {
        if (child === el || child.contains(el) || el.contains(child)) continue;
        if (child.hasAttribute('inert') || child.getAttribute('aria-hidden') === 'true') return true;
      }
    } catch (e) {}
    return false;
  };
  const centre = (VW > 2 && VH > 2)
    ? document.elementFromPoint(Math.round(VW / 2), Math.round(VH / 2))
    : null;
`

// Candidate collection across the three tiers.
const PROBE_COLLECT = `
  const cands = [];
  const seen = new Set();
  const push = (el, kind, source) => {
    if (!el || seen.has(el) || !vis(el)) return;
    if (requestedKind && requestedKind !== 'auto' && requestedKind !== kind) return;
    seen.add(el);
    const st = getComputedStyle(el);
    const z = Number.parseInt(st.zIndex, 10);
    cands.push({ el, kind, source, z: Number.isFinite(z) ? z : 0, rect: el.getBoundingClientRect() });
  };
  for (const [sel, kind] of [[':modal', 'modal'], ['[popover]:popover-open', 'popover']]) {
    try { for (const el of document.querySelectorAll(sel)) push(el, kind, 'top-layer'); } catch (e) {}
  }
  for (const [sel, kind] of ${SELECTOR_DEFS_JSON}) {
    try { for (const el of document.querySelectorAll(sel)) push(el, kind, 'markup'); } catch (e) {}
  }
  // Geometry tier: climb from the element painted at the viewport centre to its nearest
  // out-of-flow ancestor. Corroboration required — a fixed app shell covers the centre too, but
  // it does not lock the scrollbar or hide its siblings from assistive tech.
  if (centre && (scrollLock || inertBackground(centre))) {
    try {
      let node = centre;
      while (node && node !== document.body && node !== document.documentElement) {
        const st = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        if ((st.position === 'fixed' || st.position === 'absolute')
          && r.width * r.height >= VW * VH * 0.04) { push(node, 'modal', 'geometry'); break; }
        node = node.parentElement;
      }
    } catch (e) {}
  }
`

// Winner selection + naming. Engine top-layer outranks any z-index a page can declare, because the
// top layer paints above the entire stacking context by definition.
const PROBE_SELECT = `
  if (!cands.length) return null;
  const rank = (c) => (c.source === 'top-layer' ? 1 : 0);
  cands.sort((a, b) => (rank(a) - rank(b)) || (a.z - b.z));
  const best = cands[cands.length - 1];
  const el = best.el;
  // Tagging is how a caller that needs the ELEMENT (dismissal, or a preview taken from inside the
  // dialog) gets a handle back without shipping a DOM node across the serialization boundary.
  if (tagValue) { try { el.setAttribute(${JSON.stringify(OVERLAY_TAG_ATTRIBUTE)}, tagValue); } catch (e) {} }
  let name = null;
  try {
    const labelledBy = el.getAttribute('aria-labelledby');
    const labelled = labelledBy ? ((document.getElementById(labelledBy) || {}).textContent || '') : '';
    const heading = (el.querySelector('h1,h2,h3,[role="heading"]') || {}).textContent || '';
    name = String(el.getAttribute('aria-label') || labelled || heading || '').trim().slice(0, 120) || null;
  } catch (e) {}
  const signals = [];
  if (best.source === 'top-layer') signals.push('top-layer');
  // aria-modal="true" is the author stating outright that the rest of the page is inert. That is a
  // declaration, not an inference, so it ranks with the engine signals rather than the heuristics.
  try { if (el.getAttribute('aria-modal') === 'true') signals.push('aria-modal'); } catch (e) {}
  if (scrollLock) signals.push('scroll-lock');
  if (inertBackground(el)) signals.push('background-inert');
  if (centre && (el === centre || el.contains(centre))) signals.push('covers-centre');
  // A popover never blocks the page. A dialog in the DOM with no blocking signal at all is
  // reported but NOT called blocking — saying "blocked" about a decorative panel would train the
  // model to distrust the field, which is the same habituation failure as repeating a stale notice.
  const blocking = best.kind !== 'popover' && signals.length > 0;
  const r = best.rect;
  return {
    kind: best.kind,
    name,
    blocking,
    source: best.source,
    rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    signals
  };
`

/**
 * The probe as a callable function literal: `(tagValue, requestedKind) => observation | null`.
 * This is the single source every consumer builds on. Never throws — each tier is individually
 * try-guarded, because one unsupported selector must not blind the other two.
 */
export function overlayProbeFunction(): string {
  return `((tagValue, requestedKind) => {\n  try {${PROBE_HELPERS}${PROBE_COLLECT}${PROBE_SELECT}  } catch (e) { return null; }\n})`
}

/**
 * Self-contained expression form, safe to inline into a larger in-page script.
 * Pass a tag value when the caller needs to find the element again afterwards.
 */
export function overlayProbeExpression(tagValue?: string): string {
  return `${overlayProbeFunction()}(${tagValue ? JSON.stringify(tagValue) : 'null'}, 'auto')`
}

/** Statement form for BrowserTab.runJavaScript, which wraps code in an async function body. */
export function overlayProbeStatement(): string {
  return `return ${overlayProbeExpression()}`
}

const KINDS = new Set<BrowserOverlayKindName>(['dialog', 'modal', 'popover'])
const SOURCES = new Set<BrowserOverlaySource>(['top-layer', 'markup', 'geometry'])
const SIGNALS = new Set<BrowserOverlaySignal>([
  'top-layer', 'aria-modal', 'scroll-lock', 'background-inert', 'covers-centre'
])

/**
 * Validating parser for a probe result. Unlike the page_glance parser this predates, it is the ONLY
 * way an observation reaches a caller, so a field it forgets to copy is a field the model never
 * sees — the exact regression that left browser_navigate modal-blind. Round-tripped in tests.
 */
export function asOverlayObservation(value: unknown): BrowserOverlayObservation | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (!KINDS.has(row.kind as BrowserOverlayKindName)) return null
  if (!SOURCES.has(row.source as BrowserOverlaySource)) return null
  const rect = asRect(row.rect)
  if (!rect) return null
  const signals = Array.isArray(row.signals)
    ? row.signals.filter((s): s is BrowserOverlaySignal => SIGNALS.has(s as BrowserOverlaySignal))
    : []
  return {
    kind: row.kind as BrowserOverlayKindName,
    name: typeof row.name === 'string' && row.name.trim() ? row.name : null,
    blocking: row.blocking === true,
    source: row.source as BrowserOverlaySource,
    rect,
    signals
  }
}

function asRect(value: unknown): BrowserOverlayObservation['rect'] | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const nums = [row.x, row.y, row.width, row.height]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return { x: row.x as number, y: row.y as number, width: row.width as number, height: row.height as number }
}

/** True when `point` falls outside a blocking overlay's box — i.e. the click hits the backdrop. */
export function pointEscapesOverlay(
  overlay: BrowserOverlayObservation,
  point: { x: number; y: number },
  viewport?: { width: number; height: number }
): boolean {
  if (!overlay.blocking) return false
  const { x, y, width, height } = overlay.rect
  const outside = point.x < x || point.y < y || point.x > x + width || point.y > y + height
  if (!outside) return false
  // Partial centre cards (promo panels, cookie preference) set background-inert but do not
  // cover the header chrome — refuse only when the overlay occupies most of the viewport.
  if (viewport && viewport.width > 0 && viewport.height > 0) {
    const overlayArea = width * height
    const viewportArea = viewport.width * viewport.height
    if (overlayArea / viewportArea < 0.55) return false
  }
  return true
}

/** One-line identity used to decide whether the overlay CHANGED between two observations. */
export function overlayIdentity(overlay: BrowserOverlayObservation | null): string {
  if (!overlay) return 'none'
  return `${overlay.kind}|${overlay.name ?? ''}|${overlay.blocking ? 'blocking' : 'passive'}`
}
