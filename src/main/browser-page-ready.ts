// Page readiness for tools. The human-facing wait (browser-navigation-wait.ts) returns as
// soon as a page is usable to look at; a model reading the page needs to know the content
// is actually there. This polls the page and reports which state was reached rather than
// guessing, so the caller can tell the model "complete", "still loading", or "timed out".
//
// Pure over a minimal script-runner interface so tests can drive it with a fake.

import { recordOf, stringOf } from './json-coerce.js'

export type ScriptRunner = {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  isDestroyed(): boolean
}

export type PageReadiness = {
  /** dom_ready: DOM parsed. load: readyState complete. idle: complete and text stable. */
  until: 'dom_ready' | 'load' | 'idle'
  /** Also wait until this CSS selector matches. */
  selector?: string
  /** Also wait until the page's visible text contains this. */
  text?: string
  timeoutMs: number
}

export type PageReadyResult = {
  /** Last observed document.readyState ('unknown' when the page never answered). */
  readyState: string
  /** The requested `until` state was reached. */
  reached: boolean
  /** Selector/text condition met; null when none was requested. */
  conditionMet: boolean | null
  elapsedMs: number
  url: string
  title: string
}

export type PageText = {
  url: string
  title: string
  readyState: string
  text: string
  truncated: boolean
}

export const IDLE_STABLE_MS = 200
const POLL_MS = 75
const PROBE_TIMEOUT_MS = 1_000
const READ_TIMEOUT_MS = 3_000

type Probe = { readyState: string; textLength: number; url: string; title: string; selector: boolean | null; text: boolean | null }

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function waitForPageReady(
  contents: ScriptRunner,
  readiness: PageReadiness,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<PageReadyResult> {
  const started = now()
  let last: Probe | null = null
  let lastLength = -1
  let lastChangeAt = started
  for (;;) {
    const probe = await runProbe(contents, readiness)
    if (probe) {
      last = probe
      if (probe.textLength !== lastLength) {
        lastLength = probe.textLength
        lastChangeAt = now()
      }
      const stateReached = readinessReached(readiness.until, probe.readyState, now() - lastChangeAt)
      const conditionMet = conditionResult(probe)
      if (stateReached && conditionMet !== false) {
        return { readyState: probe.readyState, reached: true, conditionMet, elapsedMs: now() - started, url: probe.url, title: probe.title }
      }
    }
    if (now() - started >= readiness.timeoutMs) {
      const readyState = last?.readyState ?? 'unknown'
      return {
        readyState,
        reached: last ? readinessReached(readiness.until, readyState, now() - lastChangeAt) : false,
        conditionMet: last ? conditionResult(last) : hasCondition(readiness) ? false : null,
        elapsedMs: now() - started,
        url: last?.url ?? '',
        title: last?.title ?? ''
      }
    }
    await sleep(POLL_MS)
  }
}

/** One probe after navigation already waited for dom-ready; skip polling when that is enough. */
export async function probePageReady(
  contents: ScriptRunner,
  readiness: PageReadiness
): Promise<PageReadyResult> {
  const probe = await runProbe(contents, readiness)
  if (!probe) {
    return {
      readyState: 'unknown',
      reached: false,
      conditionMet: hasCondition(readiness) ? false : null,
      elapsedMs: 0,
      url: '',
      title: ''
    }
  }
  const conditionMet = conditionResult(probe)
  const reached = readinessReached(readiness.until, probe.readyState, 0)
  return {
    readyState: probe.readyState,
    reached: reached && conditionMet !== false,
    conditionMet,
    elapsedMs: 0,
    url: probe.url,
    title: probe.title
  }
}

export function needsReadinessPoll(readiness: PageReadiness): boolean {
  if (readiness.selector || readiness.text) return true
  return readiness.until !== 'dom_ready'
}

/**
 * Ceiling for a `raw` read. The caller bounds the text for context itself; this only keeps a
 * pathological page from being marshalled through IPC whole.
 */
const RAW_CEILING = 1_000_000

export async function readPageText(
  contents: ScriptRunner,
  options: { selector?: string; maxChars: number; raw?: boolean }
): Promise<PageText | null> {
  if (contents.isDestroyed()) return null
  const script = `(() => {
    const selector = ${JSON.stringify(options.selector ?? '')};
    const root = selector ? document.querySelector(selector) : document.body;
    if (!root) return null;
    return { url: location.href, title: document.title, readyState: document.readyState, text: root.innerText || '' };
  })()`
  try {
    const raw = await runWithTimeout(contents.executeJavaScript(script, true), READ_TIMEOUT_MS)
    const record = recordOf(raw)
    if (!record) return null
    const text = tidyText(stringOf(record.text))
    const limit = options.raw ? RAW_CEILING : options.maxChars
    const truncated = text.length > limit
    return {
      url: stringOf(record.url),
      title: stringOf(record.title),
      readyState: stringOf(record.readyState),
      text: truncated ? text.slice(0, limit) : text,
      truncated
    }
  } catch {
    return null
  }
}

export function describeReadiness(readiness: PageReadiness, result: PageReadyResult): string {
  const seconds = (result.elapsedMs / 1000).toFixed(1)
  const state = result.readyState === 'complete' ? 'complete' : result.readyState === 'interactive' ? 'dom-ready' : result.readyState
  const parts: string[] = []
  if (result.reached) {
    parts.push(`Ready: ${state}${readiness.until === 'idle' ? ' and idle' : ''} after ${seconds}s`)
  } else {
    parts.push(`Not ready: still "${state}" when the ${readiness.timeoutMs / 1000}s wait ended; content may be incomplete`)
  }
  if (readiness.selector) parts.push(`Selector ${JSON.stringify(readiness.selector)}: ${result.conditionMet ? 'found' : 'not found'}`)
  if (readiness.text) parts.push(`Text ${JSON.stringify(readiness.text)}: ${result.conditionMet ? 'present' : 'not present'}`)
  return parts.join('\n')
}

async function runProbe(contents: ScriptRunner, readiness: PageReadiness): Promise<Probe | null> {
  if (contents.isDestroyed()) return null
  const needText = Boolean(readiness.until === 'idle' || readiness.text)
  const script = `(() => {
    const selector = ${JSON.stringify(readiness.selector ?? '')};
    const needle = ${JSON.stringify(readiness.text ?? '')};
    const needText = ${needText};
    const body = needText ? document.body : null;
    const text = body ? body.innerText || '' : '';
    return {
      readyState: document.readyState,
      textLength: text.length,
      url: location.href,
      title: document.title,
      selector: selector ? Boolean(document.querySelector(selector)) : null,
      text: needle ? text.includes(needle) : null
    };
  })()`
  try {
    const raw = await runWithTimeout(contents.executeJavaScript(script, true), PROBE_TIMEOUT_MS)
    const record = recordOf(raw)
    if (!record) return null
    return {
      readyState: stringOf(record.readyState) || 'loading',
      textLength: typeof record.textLength === 'number' ? record.textLength : 0,
      url: stringOf(record.url),
      title: stringOf(record.title),
      selector: typeof record.selector === 'boolean' ? record.selector : null,
      text: typeof record.text === 'boolean' ? record.text : null
    }
  } catch {
    // The frame is navigating or tearing down; the next poll sees the new document.
    return null
  }
}

function readinessReached(until: PageReadiness['until'], readyState: string, stableForMs: number): boolean {
  if (until === 'dom_ready') return readyState !== 'loading'
  if (until === 'load') return readyState === 'complete'
  return readyState === 'complete' && stableForMs >= IDLE_STABLE_MS
}

function conditionResult(probe: Probe): boolean | null {
  if (probe.selector === null && probe.text === null) return null
  return probe.selector !== false && probe.text !== false
}

function hasCondition(readiness: PageReadiness): boolean {
  return Boolean(readiness.selector || readiness.text)
}

/** Collapse runs of blank lines and trailing spaces; innerText of real pages is mostly whitespace. */
function tidyText(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
