// Typed browser failure classification.
//
// Every browser runtime operation can fail for a materially different reason, and the
// model needs to know *which* reason to decide what to do next: retry, re-navigate,
// pick a different target, give up, or surface an invalid-input bug. Raw Error objects
// (or a generic "browser action failed") throw that signal away. This module maps the
// messy reality — Electron loadURL rejections, CDP `exceptionDetails`, debugger detach,
// destroyed/crashed WebContents — onto a small closed set of categories with a stable,
// model-readable shape.
//
// Nothing here dispatches CDP or touches Electron; it is pure classification so it can be
// unit-tested in isolation and reused by every browser code path.

export type BrowserErrorCategory =
  | 'invalid-input' // caller passed a missing/malformed argument (no CDP was attempted)
  // A WELL-FORMED target that resolved to nothing — a name/selector that matched no
  // element. Distinct from invalid-input on purpose: the fix is not "correct the call
  // shape" but "look again and target something that is actually there" (the view may
  // have changed, the element may have scrolled out, another chat may own the surface).
  // Folding the two together, as this module did before, tells the caller to go audit
  // its arguments when the arguments were fine.
  | 'no-match'
  // The target exists and the call is well formed, but SOMEONE ELSE holds it — another
  // running chat owns the tab lease, or a capture/replay is already active on it. Also
  // distinct from invalid-input on purpose: the remedy is to coordinate (read the holder
  // with peer_chats, stop the running session, or use a different tab), never to rewrite
  // the arguments. Not retryable for the same reason no-match is not: the resolution is a
  // decision, and an identical immediate retry hits the same holder.
  | 'conflict'
  | 'target-closed' // the WebContents/tab was destroyed before/while the op ran
  | 'target-crashed' // the renderer process is gone (crash, oom, killed)
  | 'target-unresponsive' // renderer alive but hung; op could not complete in time
  | 'cdp-detached' // the debugger session detached (target closed, DevTools opened)
  | 'navigation-failed' // a load failed for a non-abort reason (bad cert, DNS, refused)
  | 'timeout' // the operation exceeded its deadline
  | 'js-exception' // page JavaScript threw (Runtime.evaluate exceptionDetails / rejected promise)
  | 'network-body-unavailable' // a response body was requested but is not (or no longer) buffered
  | 'unsupported' // the requested capability/command is not available in this runtime
  | 'cancelled' // the operation was intentionally aborted
  | 'internal' // anything we could not attribute to a more specific cause

// The model-facing failure envelope. Compact and JSON-stable: `ok:false` mirrors the
// `ok:true` success shape the tools already return, `category` is the actionable signal,
// `retryable` is a coarse hint, and `detail` carries an optional bounded diagnostic.
export type BrowserErrorPayload = {
  ok: false
  category: BrowserErrorCategory
  message: string
  retryable: boolean
  detail?: string
}

const RETRYABLE: ReadonlySet<BrowserErrorCategory> = new Set([
  'target-crashed',
  'target-unresponsive',
  'cdp-detached',
  'timeout'
])

// A classified browser failure. Thrown across the browser layer and unwrapped at the
// tool boundary into a BrowserErrorPayload. Carrying a real Error subclass (rather than a
// bare payload) keeps stack traces intact for main-process logs while still exposing the
// category to callers that catch it.
export class BrowserError extends Error {
  readonly category: BrowserErrorCategory
  readonly retryable: boolean
  readonly detail?: string

  constructor(category: BrowserErrorCategory, message: string, detail?: string) {
    super(message)
    this.name = 'BrowserError'
    this.category = category
    this.retryable = RETRYABLE.has(category)
    this.detail = detail
  }

  toPayload(): BrowserErrorPayload {
    const payload: BrowserErrorPayload = {
      ok: false,
      category: this.category,
      message: this.message,
      retryable: this.retryable
    }
    if (this.detail !== undefined) payload.detail = this.detail
    return payload
  }
}

// Reason strings Electron reports on `render-process-gone` (RenderProcessGoneDetails.reason).
// Documented values: clean-exit | abnormal-exit | killed | crashed | oom | launch-failed |
// integrity-failure | memory-eviction. All of them mean the renderer is gone, so any op in
// flight against that target failed for a crash-class reason.
const CRASH_REASONS: ReadonlySet<string> = new Set([
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'memory-eviction'
])

export function isRendererGoneReason(reason: string): boolean {
  return CRASH_REASONS.has(reason)
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

// Ordered classification rules. First match wins, so more-specific phrasings precede
// broader ones (ERR_ABORTED before the generic ERR_ pattern; "target closed" before the
// bare "detached"). Each predicate inspects the lowercased message unless it needs the
// original casing (ERR_ codes), which it takes from the closure. Keeping this as data
// rather than a nested if-chain holds cyclomatic complexity flat as categories grow.
type Rule = { category: BrowserErrorCategory; test: (lower: string, raw: string) => boolean }

const has = (...needles: string[]) => (lower: string) => needles.some((needle) => lower.includes(needle))

const RULES: readonly Rule[] = [
  // Destroyed / closed target. Electron: "Object has been destroyed", "WebContents ...
  // destroyed", "Render frame was disposed". CDP: "Target closed" / "Session ... not found".
  {
    category: 'target-closed',
    test: has(
      'object has been destroyed',
      'has been destroyed',
      'was destroyed',
      'render frame was disposed',
      'target closed',
      'no target with given id',
      'session with given id not found',
      'no active browser tab'
    )
  },
  // Renderer crash. debugger.sendCommand after a crash rejects with a crash/detach message.
  { category: 'target-crashed', test: has('crashed', 'out of memory', 'renderer process gone') },
  { category: 'cdp-detached', test: has('debugger is not attached', 'detached', 'not attached to') },
  // withToolTimeout throws "Tool timed out after Nms"; bounded waits throw "timeout: ...".
  { category: 'timeout', test: (lower) => lower.startsWith('tool timed out') || lower.includes('timed out') || lower.startsWith('timeout') },
  // ERR_ABORTED (name or bare "(-3) loading '" errno form) is a superseded/cancelled load,
  // not a failure — classify before the generic ERR_ rule.
  { category: 'cancelled', test: (lower, raw) => raw.startsWith('ERR_ABORTED') || lower.includes('err_aborted') || /\(-3\) loading '/.test(raw) },
  { category: 'navigation-failed', test: (lower, raw) => /\berr_[a-z_]+/i.test(raw) || (lower.includes('loading') && lower.includes("'")) }
]

// Map an arbitrary thrown value to a BrowserError. Already-classified errors pass through
// unchanged so a specific category assigned at the throw site is never downgraded to
// `internal` by re-classification. `fallback` lets a call site bias unattributed failures
// toward the category most likely for that operation (e.g. a screenshot failing is far
// more often a dead target than a JS exception).
export function classifyBrowserError(
  error: unknown,
  fallback: BrowserErrorCategory = 'internal'
): BrowserError {
  if (error instanceof BrowserError) return error
  const message = messageOf(error)
  const lower = message.toLowerCase()
  const rule = RULES.find((candidate) => candidate.test(lower, message))
  return new BrowserError(rule?.category ?? fallback, message)
}

// Convert any thrown value into the model-facing envelope in one step.
export function toBrowserErrorPayload(
  error: unknown,
  fallback: BrowserErrorCategory = 'internal'
): BrowserErrorPayload {
  return classifyBrowserError(error, fallback).toPayload()
}

// Re-stamp a classified error with a diagnostic, preserving its category. Used where the
// cause of a failure is invisible from the message alone (e.g. a capture timeout says
// nothing about whether the surface was even renderable).
export function withDetail(error: BrowserError, detail: string): BrowserError {
  if (error.detail !== undefined) return error
  return new BrowserError(error.category, error.message, detail)
}
