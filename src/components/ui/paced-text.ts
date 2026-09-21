import { useEffect, useRef, useState } from 'react'

/**
 * Typewriter pacing for streamed text. Providers deliver text in whatever chunks their protocol
 * produces — single tokens, sentence bursts, or a whole answer on one event (Antigravity can put
 * all of a step's text on its DONE half) — so painting chunks as they arrive looks different per
 * provider. The displayed prefix instead trails the received text by a bounded catch-up window:
 * every backlog drains within ~REVEAL_CATCH_UP_MS regardless of size, so pacing adds a fixed,
 * small latency and can never fall behind a fast stream or stall an interrupted one.
 */

/** How long a reveal takes to catch up with everything received so far. */
export const REVEAL_CATCH_UP_MS = 180

/**
 * The next number of UTF-16 units to display. Progress is at least one unit per tick and
 * proportional to the backlog, and never splits a surrogate pair (the boundary moves forward,
 * keeping progress monotonic).
 */
export function revealStep(text: string, shown: number, elapsedMs: number): number {
  const target = text.length
  if (shown >= target) return target
  const pending = target - shown
  const advance = Math.max(1, Math.round(pending * Math.min(1, elapsedMs / REVEAL_CATCH_UP_MS)))
  let next = Math.min(target, shown + advance)
  if (next < target && isHighSurrogate(text.charCodeAt(next - 1))) next += 1
  return next
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
    if (settled || prefersReducedMotion() || !extendsShownText(previous, text, shownRef.current)) {
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
      const next = revealStep(text, shownRef.current, elapsed)
      show(next)
      if (next < text.length) frameRef.current = window.requestAnimationFrame(tick)
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
