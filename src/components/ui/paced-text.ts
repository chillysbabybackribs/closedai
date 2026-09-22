import { useEffect, useRef, useState } from 'react'

/**
 * Typewriter pacing for streamed text. Providers deliver text in whatever chunks their protocol
 * produces — single tokens, sentence bursts, or a whole answer on one event (Antigravity can put
 * all of a step's text on its DONE half) — so painting chunks as they arrive looks different per
 * provider. The displayed prefix instead trails the received text, revealed at a rate that follows
 * the arrival rate instead of the momentary backlog: a chunk landing does not make the next frame
 * fast and the frames after it slow, which reads as a visible surge every time a chunk arrives.
 * The reveal still cannot fall behind a fast stream or stall an interrupted one, because a backlog
 * older than REVEAL_MAX_LAG_MS drains regardless of the rate.
 */

/** The shortest lag the reveal settles at: the pacing a token-at-a-time stream gets. */
export const REVEAL_MIN_LAG_MS = 180

/** No backlog waits longer than this, whatever rate the stream has settled at. */
export const REVEAL_MAX_LAG_MS = 700

/** How quickly the reveal rate follows a change in the arrival rate. */
export const REVEAL_RATE_ADAPT_MS = 420

/** Weight of the newest gap between chunks in the tracked arrival cadence. */
const ARRIVAL_SMOOTHING = 0.3

/** Displayed units, and the reveal rate in UTF-16 units per millisecond carried between ticks. */
export type RevealState = {
  rate: number
  shown: number
}

/**
 * The lag to aim for behind a stream whose chunks arrive this far apart. Trailing by about one
 * chunk is what lets a steady rate span the gap between two of them: aim for less and the reveal
 * empties its backlog and waits, which is the same stutter as surging, upside down.
 */
export function revealTargetLagMs(arrivalIntervalMs: number): number {
  return Math.min(REVEAL_MAX_LAG_MS, Math.max(REVEAL_MIN_LAG_MS, arrivalIntervalMs))
}

/** The tracked gap between chunk arrivals. A gap past the cap cannot raise the target further. */
export function nextArrivalInterval(previousMs: number, gapMs: number): number {
  const sample = Math.min(REVEAL_MAX_LAG_MS, Math.max(0, gapMs))
  return previousMs + (sample - previousMs) * ARRIVAL_SMOOTHING
}

/**
 * The next reveal state. The rate eases toward the one that would hold the backlog at
 * `targetLagMs`, so a steady stream reveals at the speed it arrives and chunk boundaries stop
 * modulating it — the previous step revealed a fixed fraction of the backlog, which made every
 * arriving chunk a surge followed by a crawl. Progress is at least one unit per tick, at least
 * enough to keep any backlog under REVEAL_MAX_LAG_MS whatever the rate has adapted to, and never
 * splits a surrogate pair (the boundary moves forward, keeping progress monotonic).
 */
export function revealStep(
  text: string,
  state: RevealState,
  elapsedMs: number,
  targetLagMs: number = REVEAL_MIN_LAG_MS
): RevealState {
  const target = text.length
  if (state.shown >= target) return { rate: state.rate, shown: target }
  const pending = target - state.shown
  const demand = pending / Math.max(1, targetLagMs)
  const rate = state.rate + (demand - state.rate) * Math.min(1, elapsedMs / REVEAL_RATE_ADAPT_MS)
  const overdue = pending * Math.min(1, elapsedMs / REVEAL_MAX_LAG_MS)
  const advance = Math.max(1, Math.round(Math.max(rate * elapsedMs, overdue)))
  let next = Math.min(target, state.shown + advance)
  if (next < target && isHighSurrogate(text.charCodeAt(next - 1))) next += 1
  return { rate, shown: next }
}

/** Whether streamed text still extends what is already displayed, or replaced it. */
export function extendsShownText(previous: string, next: string, shown: number): boolean {
  return next.startsWith(previous.slice(0, Math.min(shown, previous.length)))
}

/**
 * The displayed prefix of a streaming message. A settled message renders in full immediately, as
 * do replacements (text that no longer extends what is shown) and reduced-motion sessions. A
 * still-streaming message mounts at zero and cascades in, so text that arrives in bulk — a pane
 * becoming visible mid-turn, or a whole-answer chunk — sweeps in over the catch-up window instead
 * of popping.
 */
export function usePacedText(text: string, settled: boolean): string {
  const [shown, setShown] = useState(() => (settled ? text.length : 0))
  const shownRef = useRef(shown)
  // The rate and the tracked cadence survive catching up between chunks. Restarting either for
  // every chunk would re-create the surge this pacing exists to remove.
  const rateRef = useRef(0)
  const intervalRef = useRef(REVEAL_MIN_LAG_MS)
  const arrivedAtRef = useRef(0)
  const previousTextRef = useRef(text)
  const frameRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)

  useEffect(() => {
    const previous = previousTextRef.current
    previousTextRef.current = text
    const show = (count: number): void => {
      shownRef.current = count
      setShown(count)
    }
    if (text.length > previous.length) {
      const now = performance.now()
      if (arrivedAtRef.current > 0) {
        intervalRef.current = nextArrivalInterval(intervalRef.current, now - arrivedAtRef.current)
      }
      arrivedAtRef.current = now
    }
    if (settled || prefersReducedMotion() || !extendsShownText(previous, text, shownRef.current)) {
      rateRef.current = 0
      if (shownRef.current !== text.length) show(text.length)
      return
    }
    if (shownRef.current >= text.length) {
      if (shownRef.current > text.length) show(text.length)
      return
    }
    lastTickRef.current = performance.now()
    const tick = (now: number): void => {
      frameRef.current = null
      const elapsed = Math.max(1, now - lastTickRef.current)
      lastTickRef.current = now
      const next = revealStep(
        text,
        { rate: rateRef.current, shown: shownRef.current },
        elapsed,
        revealTargetLagMs(intervalRef.current)
      )
      rateRef.current = next.rate
      show(next.shown)
      if (next.shown < text.length) frameRef.current = window.requestAnimationFrame(tick)
    }
    frameRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    }
  }, [text, settled])

  return shown >= text.length ? text : text.slice(0, shown)
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
