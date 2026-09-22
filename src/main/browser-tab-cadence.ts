// Whether a tab's page is given real cycles while a model is driving it.
//
// Chromium throttles a hidden page hard, and a model's tab is hidden whenever it is not the
// selected one. Measured on Electron 44 against a hidden WebContentsView: setTimeout fires at
// ~1 Hz (a 50 ms timer landed at 1371 ms, 2371 ms, …) and requestAnimationFrame never runs at
// all. Everything a modern page defers — hydration, lazy fetches, scroll/intersection work,
// anything chained off a timer — therefore crawled or stopped, so a tool waiting for text,
// a selector or an idle page burned its whole budget on a page that was not being given cycles.
//
// A runtime setBackgroundThrottling(false) restores both for that WebContents while it stays
// hidden: 50 ms timers and 60 fps rAF (the webPreferences flag alone restores timers but not
// rAF — only the runtime call does). visibilityState stays 'hidden', which is honest: the page
// is not on screen.
//
// Frames and timers are not free (see browser-tab-rendering.ts for what idle background tabs
// cost), so the exemption is scoped: a tab gets it while a tool operates on it and for a grace
// window afterwards, which collapses a model's burst of back-to-back calls into one exemption
// and leaves the page running at full speed while the model reads the result and decides.

export const CADENCE_GRACE_MS = 5_000

export type TabCadenceAdapter = {
  /** `throttled` true is Chromium's default (Electron's `setBackgroundThrottling(allowed)`). */
  setThrottled(tabId: string, throttled: boolean): void
}

export type ThrottleableContents = { isDestroyed(): boolean; setBackgroundThrottling(allowed: boolean): void }

export type TabCadenceTargets = {
  /**
   * The tab's page, or null when it must be left alone: it is closed, or something else owns its
   * surface. A tab parked in the offscreen capture window is the case that matters — Electron
   * arms the exemption by showing the widget, and doing that under a capture leaves capturePage
   * with "Current display surface not available for capture".
   */
  contents(tabId: string): ThrottleableContents | null
  /** Whether the tab's page is on screen right now. */
  onScreen(tabId: string): boolean
}

/** Adapter over live tabs. Only the runtime call restores animation frames to a hidden view. */
export function webContentsCadence(targets: TabCadenceTargets): TabCadenceAdapter {
  return {
    setThrottled: (tabId, throttled) => {
      const contents = targets.contents(tabId)
      if (!contents || contents.isDestroyed()) return
      // Never arm a page the user is looking at. It runs at full speed already, and arming shows
      // the widget: doing that to the foreground tab costs it input focus, so a dispatched key
      // lands nowhere (reproduced in scripts/browser-coordination-live-check.mjs).
      if (!throttled && targets.onScreen(tabId)) return
      contents.setBackgroundThrottling(throttled)
    }
  }
}

export class TabCadencePolicy {
  private readonly holds = new Map<string, number>()
  private readonly grace = new Map<string, ReturnType<typeof setTimeout>>()
  /** Tabs that should be exempt while hidden; whether one is armed right now is the adapter's. */
  private readonly wanted = new Set<string>()

  constructor(
    private readonly adapter: TabCadenceAdapter,
    private readonly graceMs: number = CADENCE_GRACE_MS
  ) {}

  /**
   * Hold full cadence for one operation, such as a navigation that has to run to readiness.
   * Holds nest; the returned release is idempotent and opens the grace window.
   */
  hold(tabId: string): () => void {
    this.holds.set(tabId, (this.holds.get(tabId) ?? 0) + 1)
    this.clearGrace(tabId)
    this.apply(tabId)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (this.holds.get(tabId) ?? 1) - 1
      if (remaining > 0) {
        this.holds.set(tabId, remaining)
        return
      }
      this.holds.delete(tabId)
      this.startGrace(tabId)
    }
  }

  /** One call against an already-loaded page: full cadence for the grace window. */
  touch(tabId: string): void {
    this.apply(tabId)
    if ((this.holds.get(tabId) ?? 0) > 0) return
    this.startGrace(tabId)
  }

  /**
   * The visible tab changed: hand the new one back to Chromium — it needs no exemption on screen —
   * and re-arm every other tab that still holds one. Electron arms the exemption on the widget
   * that exists when it is set, so a tab that has just been hidden has to be told again or its
   * page drops back to ~1 Hz with no frames while a tool is still working in it.
   */
  handoff(activeTabId: string | null): void {
    for (const tabId of this.wanted) this.adapter.setThrottled(tabId, tabId === activeTabId)
  }

  /** The tab is gone: drop its timers without touching a destroyed WebContents. */
  forget(tabId: string): void {
    this.clearGrace(tabId)
    this.holds.delete(tabId)
    this.wanted.delete(tabId)
  }

  /** Test/diagnostic view of why a tab is currently exempt. */
  describe(tabId: string): { wanted: boolean; holds: number; inGrace: boolean } {
    return {
      wanted: this.wanted.has(tabId),
      holds: this.holds.get(tabId) ?? 0,
      inGrace: this.grace.has(tabId)
    }
  }

  dispose(): void {
    for (const timer of this.grace.values()) clearTimeout(timer)
    this.grace.clear()
    this.holds.clear()
    this.wanted.clear()
  }

  private apply(tabId: string): void {
    this.wanted.add(tabId)
    // Always re-apply rather than skipping a tab that already holds the exemption: parking and
    // reparenting hide a surface without any activation change, and both disarm it.
    this.adapter.setThrottled(tabId, false)
  }

  private startGrace(tabId: string): void {
    this.clearGrace(tabId)
    const timer = setTimeout(() => {
      this.grace.delete(tabId)
      if ((this.holds.get(tabId) ?? 0) > 0) return
      this.wanted.delete(tabId)
      this.adapter.setThrottled(tabId, true)
    }, this.graceMs)
    // Restoring Chromium's default must never be the reason the process stays alive.
    timer.unref?.()
    this.grace.set(tabId, timer)
  }

  private clearGrace(tabId: string): void {
    const timer = this.grace.get(tabId)
    if (!timer) return
    clearTimeout(timer)
    this.grace.delete(tabId)
  }
}
