// Which tabs are allowed to produce frames, and when.
//
// Background tabs are DETACHED from the window's content tree rather than merely hidden. A
// WebContentsView that stays in the tree keeps running requestAnimationFrame at the display's
// full rate even while invisible and even with backgroundThrottling enabled — that flag drops
// timers to ~1 Hz but never stops rAF or compositing. So every background tab cost a full
// scene's worth of GPU for as long as it existed, and a handful of idle WebGL pages was enough
// to hold the GPU process near saturation on its own.
//
// Removing the view from the content tree takes it to zero frames while leaving the page
// completely alive: script runs, timers keep their normal cadence, navigation and CDP still
// work, and page state is untouched. What a detached view cannot do is produce pixels — every
// capture path hangs on one, including the fromSurface:false + device-metrics path that serves
// hidden worker tabs. Frames are therefore leased: anything that needs them pins the tab first.
//
// Both claims are measured, not inferred — scripts/probe-hidden-view-throttling.mjs and
// scripts/probe-detached-frameless-capture.mjs reproduce them from a bare Electron window.

export type TabRenderingAdapter = {
  attach(tabId: string): void
  detach(tabId: string): void
  // Called after any attach so the owner can restore z-order: Electron raises a re-added view
  // to the top of the content tree, which would otherwise let a pinned background tab paint
  // over the one the user is looking at.
  raiseActive(): void
}

// How long a tab keeps its frames after its last pin releases. A model driving one tab makes a
// burst of back-to-back calls against it, and attach/detach per call would churn a compositor
// surface each time; this collapses a burst into one attach. It also leaves a settling window
// in which a page finishes the animation an agent just triggered.
const PIN_GRACE_MS = 5_000

export class TabRenderingPolicy {
  private readonly pins = new Map<string, number>()
  private readonly grace = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly known = new Set<string>()
  // Tabs that opt out entirely and stay attached for life. Hidden worker tabs live in their own
  // never-mapped window, where this policy has nothing to win and their capture path already
  // depends on a permanently pinned viewport.
  private readonly exempt = new Set<string>()
  private readonly attached = new Set<string>()
  private activeId: string | null = null
  private paneVisible = true

  constructor(
    private readonly adapter: TabRenderingAdapter,
    private readonly graceMs: number = PIN_GRACE_MS
  ) {}

  register(tabId: string, options: { exempt?: boolean } = {}): void {
    this.known.add(tabId)
    if (options.exempt) this.exempt.add(tabId)
    this.sync(tabId)
  }

  // Forget a closed tab. Deliberately does NOT detach: the caller is destroying the view and
  // does its own removeChildView, and detaching an already-disposed view throws.
  unregister(tabId: string): void {
    const timer = this.grace.get(tabId)
    if (timer) clearTimeout(timer)
    this.grace.delete(tabId)
    this.pins.delete(tabId)
    this.known.delete(tabId)
    this.exempt.delete(tabId)
    this.attached.delete(tabId)
    if (this.activeId === tabId) this.activeId = null
  }

  setActive(tabId: string | null): void {
    if (this.activeId === tabId) return
    const previous = this.activeId
    this.activeId = tabId
    if (previous !== null) this.sync(previous)
    if (tabId !== null) this.sync(tabId)
  }

  // The browser pane itself went away (the workspace switched to the editor, say). Nothing is on
  // screen, so even the active tab stops paying for frames.
  setPaneVisible(visible: boolean): void {
    if (this.paneVisible === visible) return
    this.paneVisible = visible
    for (const tabId of this.known) this.sync(tabId)
  }

  /**
   * Hold frames on a tab for the duration of one operation. Pins nest; the returned release is
   * idempotent so a caller can run it from a `finally` without tracking whether it already ran.
   */
  pin(tabId: string): () => void {
    if (!this.known.has(tabId)) return () => {}
    this.clearGrace(tabId)
    this.pins.set(tabId, (this.pins.get(tabId) ?? 0) + 1)
    this.sync(tabId)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (this.pins.get(tabId) ?? 1) - 1
      if (remaining > 0) {
        this.pins.set(tabId, remaining)
        return
      }
      this.pins.delete(tabId)
      this.startGrace(tabId)
    }
  }

  isAttached(tabId: string): boolean {
    return this.attached.has(tabId)
  }

  // Test/diagnostic view of why a tab is currently rendering.
  describe(tabId: string): { attached: boolean; pins: number; inGrace: boolean; exempt: boolean } {
    return {
      attached: this.attached.has(tabId),
      pins: this.pins.get(tabId) ?? 0,
      inGrace: this.grace.has(tabId),
      exempt: this.exempt.has(tabId)
    }
  }

  dispose(): void {
    for (const timer of this.grace.values()) clearTimeout(timer)
    this.grace.clear()
    this.pins.clear()
    this.known.clear()
    this.exempt.clear()
    this.attached.clear()
    this.activeId = null
  }

  private shouldRender(tabId: string): boolean {
    if (this.exempt.has(tabId)) return true
    if ((this.pins.get(tabId) ?? 0) > 0) return true
    if (this.grace.has(tabId)) return true
    return this.paneVisible && tabId === this.activeId
  }

  private sync(tabId: string): void {
    if (!this.known.has(tabId)) return
    const want = this.shouldRender(tabId)
    if (want === this.attached.has(tabId)) return
    if (want) {
      this.attached.add(tabId)
      this.adapter.attach(tabId)
      // Re-adding raises this view above the active one; put the active tab back on top.
      if (tabId !== this.activeId) this.adapter.raiseActive()
      return
    }
    this.attached.delete(tabId)
    this.adapter.detach(tabId)
  }

  private startGrace(tabId: string): void {
    this.clearGrace(tabId)
    // A close can unregister the tab before the in-flight operation's finally block
    // releases its rendering pin. That stale release must not create a new grace timer
    // for a tab whose view and WebContents are already gone.
    if (!this.known.has(tabId)) return
    // An unpinned ACTIVE tab keeps rendering on its own merits — no need to hold a timer open.
    if (this.paneVisible && tabId === this.activeId) {
      this.sync(tabId)
      return
    }
    const timer = setTimeout(() => {
      this.grace.delete(tabId)
      this.sync(tabId)
    }, this.graceMs)
    // A pending detach must never be the reason the process stays alive.
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
