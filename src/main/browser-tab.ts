import { WebContentsView, type LoadURLOptions, type WebContents, type WebContentsViewConstructorOptions } from 'electron'
import { EventEmitter } from 'node:events'
import type { BrowserHistory } from './browser-history-store.js'
import type { BrowserBounds, BrowserState } from '../shared/types.js'
import { normalizeUrl, isAbortedNavigation, PARTITION } from './browser-url.js'
import { BrowserError, classifyBrowserError } from './browser-error.js'
import { waitForUsableLoad } from './browser-navigation-wait.js'
import { EMBEDDED_BROWSER_SCROLLBAR_CSS } from './browser-page-style.js'
import type { CreatePopupTab, PopupTabRequest } from './browser-popup-policy.js'
import type { WebPermissionPolicy } from '../shared/security.js'
import { attachBrowserTabWebContentsEvents } from './browser-tab-attach-events.js'
import { BrowserNavigationFailureState } from './browser-navigation-failure-state.js'
import {
  CHROME_BASE_COLOR,
  DEFAULT_PAGE_BASE_COLOR,
  PAGE_BACKGROUND_PROBE,
  PageBackgroundMemory,
  pageBackgroundColor
} from './browser-page-background.js'
import { browserOccludedBounds, refreshVisibleBrowserSurface } from './browser-surface-visibility.js'
import {
  exportNavigationStack,
  type PersistedNavigationStack
} from './browser-navigation-stack.js'
export { HOME_URL, normalizeUrl, PARTITION } from './browser-url.js'

// One tab = one WebContentsView plus its navigation state. BrowserService owns the collection
// and the single visible tab. Ordinary browsing stays native: no debugger ever attaches.

// Keep hidden views in a valid minimal surface. Extreme offscreen bounds can initialize a
// compositor before real pane bounds exist, producing rejected WidgetHost frame-sink messages.
const hiddenBounds: BrowserBounds = { x: 0, y: 0, width: 1, height: 1 }
// The page view composites ABOVE the renderer's DOM, so the rounded bezel `.browser-view-host`
// draws under it never shows; rounding the native view itself is the only thing that works.
// Tracks the border-radius in src/renderer/styles/browser.css.
export const PAGE_CORNER_RADIUS = 7
// Bound on the first-paint probe that lets a navigation settle early; a throttled hidden tab
// never answers and falls back to the fixed settle inside waitForUsableLoad.
const PAINT_PROBE_MS = 500
const MAX_CUSTOM_TITLE_LENGTH = 300

let nextTabId = 1

export function allocateTabId(): string { return `tab-${nextTabId++}` }

/**
 * A restored tab keeps the id it was persisted under, so a model's `tab_id` from before the
 * restart still names the same page. New tabs then count on from above every restored id.
 */
export function reserveTabId(id: string): void {
  const number = Number(id.replace(/^tab-/, ''))
  if (Number.isInteger(number) && number >= nextTabId) nextTabId = number + 1
}

type TabLiveness =
  | { alive: true }
  | { alive: false; category: 'target-closed' | 'target-crashed'; detail: string }

export class BrowserTab extends EventEmitter {
  /** Settings → Security web permission policy for this tab's pickers; the service sets it per tab. */
  permissionPolicy: () => WebPermissionPolicy = () => 'allow'
  readonly id: string
  readonly view: WebContentsView
  private bounds: BrowserBounds = hiddenBounds
  /** Emulated viewport size; the native surface shrinks to it so the page really lays out there. */
  private emulatedViewport: { width: number; height: number } | null = null
  private visible = false
  private favicon: string | null = null
  private customTitle: string | null = null
  private liveness: TabLiveness = { alive: true }
  // What the view paints where the page does not. Always kept equal to what is on screen now
  // or what is about to be — see applyBaseColor.
  private baseColor = CHROME_BASE_COLOR
  // Whether a document has ever committed here. A tab that has never held one has no page to
  // assume a colour for, so it keeps the app's bezel rather than the browser's white.
  private hasDocument = false
  private readonly navigationFailures = new BrowserNavigationFailureState()
  private state: BrowserState = {
    url: 'about:blank',
    title: 'New Tab',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    navigationError: null
  }

  constructor(
    private readonly history: BrowserHistory,
    private readonly openLinkInNewTab: (request: PopupTabRequest) => void,
    readonly partition: string = PARTITION,
    private readonly createPopupTab?: CreatePopupTab,
    // Shared across the window's tabs: a page's canvas colour belongs to the site, not to
    // whichever view happened to load it first.
    private readonly pageBackgrounds: PageBackgroundMemory = new PageBackgroundMemory(),
    // A persisted id to restore under; a fresh tab takes the next counter value.
    id?: string,
    popupOptions?: WebContentsViewConstructorOptions
  ) {
    super()
    if (id) reserveTabId(id)
    this.id = id ?? allocateTabId()
    // Node throws on unhandled 'error'; the service subscribes, but keep a no-op fallback.
    this.on('error', () => {})
    this.view = new WebContentsView({
      ...(popupOptions?.webContents ? { webContents: popupOptions.webContents } : {}),
      webPreferences: {
        ...popupOptions?.webPreferences,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition,
        backgroundThrottling: true,
        // Chrome parity: audible autoplay needs a user activation, WebSQL is gone, and a page
        // spamming dialogs gets the "prevent this page from creating additional dialogs" guard.
        autoplayPolicy: 'document-user-activation-required',
        enableWebSQL: false,
        safeDialogs: true
      }
    })
    // A tab holding no document yet shows the app's own bezel colour rather than the browser
    // default of white — there is no page to assume anything about, and white here is the
    // flash. The base colour then tracks the page for the rest of the tab's life; see
    // browser-page-background.ts for the invariant and applyBaseColor below for the rules.
    this.view.setBackgroundColor(this.baseColor)
    this.view.setBorderRadius(PAGE_CORNER_RADIUS)
    this.view.setVisible(false)
    this.view.setBounds(hiddenBounds)
    this.attachEvents()
  }

  exportNavigationStack(): PersistedNavigationStack | null {
    if (!this.liveness.alive || this.view.webContents.isDestroyed()) return null
    const history = this.view.webContents.navigationHistory
    return exportNavigationStack(history.getAllEntries(), history.getActiveIndex())
  }

  // The first real navigation IS the bootstrap; no about:blank preload.
  start(url: string, options?: LoadURLOptions, restoredStack?: PersistedNavigationStack | null): Promise<void> {
    if (restoredStack && restoredStack.entries.length > 1) {
      return this.restoreNavigationStack(restoredStack, url, options)
    }
    return this.navigate(url, options)
  }

  private async restoreNavigationStack(
    stack: PersistedNavigationStack,
    fallbackUrl: string,
    options?: LoadURLOptions
  ): Promise<void> {
    this.assertAlive()
    const active = stack.entries[stack.index] ?? stack.entries.at(-1)!
    this.navigationFailures.begin(active.url, this.state, this.liveContents?.getURL())
    this.prepareBaseColorFor(active.url)
    try {
      const load = this.view.webContents.navigationHistory.restore({
        entries: stack.entries,
        index: stack.index
      })
      load.catch(() => {})
      await waitForUsableLoad(this.view.webContents, load, undefined, undefined, () => this.framePainted())
      this.refreshVisibleSurface()
    } catch (error) {
      if (isAbortedNavigation(error)) return
      await this.navigate(fallbackUrl, options)
    }
  }

  getState(): BrowserState {
    this.refreshState()
    return this.state
  }

  // Adopt a persisted tab's identity before anything loads, so a restored strip shows the
  // real page labels on the first frame instead of a row of "New Tab".
  seedRestoredState(url: string, title: string, customTitle?: string | null): void {
    this.state = { ...this.state, url, title: title || this.state.title }
    this.customTitle = normalizeCustomTitle(customTitle)
  }

  getFavicon(): string | null {
    return this.favicon
  }

  getCustomTitle(): string | null {
    return this.customTitle
  }

  rename(title: string | null): void {
    const next = normalizeCustomTitle(title)
    if (next === this.customTitle) return
    this.customTitle = next
    this.emit('state')
  }

  // Show/position this tab's view, or hide it (used when another tab is active).
  applyBounds(bounds: BrowserBounds, show: boolean): void {
    const wasVisible = this.visible
    this.bounds = sanitizeBounds(bounds)
    this.visible = show && this.bounds.width > 1 && this.bounds.height > 1
    if (!show && bounds.occluded === true && this.bounds.width > 1 && this.bounds.height > 1) {
      // Keep the loaded native surface mapped and full-sized so Chromium keeps laying it out and
      // producing frames at the pane's size. The renderer's freeze still covers the browser box
      // while this view sits almost entirely outside the window; restoring its real bounds later
      // avoids the setVisible(false/true) blanking bug.
      this.view.setBounds(browserOccludedBounds(this.surfaceBounds()))
      this.view.setVisible(true)
      return
    }
    this.view.setBounds(this.keepRealSurface() ? this.surfaceBounds() : hiddenBounds)
    this.view.setVisible(this.visible)
    if (this.visible && !wasVisible) this.refreshVisibleSurface()
  }

  /**
   * Size the native surface to an emulated viewport, or null to go back to filling the pane.
   *
   * A headful compositing widget ignores the view size in `Emulation.setDeviceMetricsOverride`:
   * screen metrics, pixel ratio and touch points all apply, but the layout viewport keeps
   * following the real widget, so a responsive site keeps serving its desktop breakpoint. DevTools
   * device mode resizes the inspected view for exactly this reason, and so does this — the page
   * then lays out at the width it was asked for instead of only believing it did.
   */
  setEmulatedViewport(size: { width: number; height: number } | null): void {
    this.emulatedViewport = size
    this.applyBounds(this.bounds, this.visible)
  }

  /** Pane bounds, or the emulated viewport centred inside them. */
  private surfaceBounds(): BrowserBounds {
    const emulated = this.emulatedViewport
    if (!emulated) return this.bounds
    const width = Math.max(1, Math.min(emulated.width, this.bounds.width))
    const height = Math.max(1, Math.min(emulated.height, this.bounds.height))
    return {
      ...this.bounds,
      x: this.bounds.x + Math.round((this.bounds.width - width) / 2),
      y: this.bounds.y,
      width,
      height
    }
  }

  // A tab collapsed to 1x1 reports useless element geometry and breaks IntersectionObserver;
  // hidden tabs keep their real bounds once the pane has reported any.
  private keepRealSurface(): boolean {
    if (this.visible) return true
    return this.bounds.width > 1 && this.bounds.height > 1
  }

  hide(): void {
    this.visible = false
    this.view.setVisible(false)
    this.view.setBounds(this.bounds.width > 1 ? this.surfaceBounds() : hiddenBounds)
  }

  // Park a freshly created background tab at the pane's real bounds so its first layout
  // is honest even though it has never been shown.
  park(bounds: BrowserBounds): void {
    if (bounds.width <= 1 || bounds.height <= 1) return
    this.bounds = sanitizeBounds(bounds)
    this.visible = false
    this.view.setVisible(false)
    this.view.setBounds(this.surfaceBounds())
  }

  async navigate(input: string, options?: LoadURLOptions): Promise<void> {
    this.assertAlive()
    const url = normalizeUrl(input, this.state.url)
    this.navigationFailures.begin(url, this.state, this.liveContents?.getURL())
    this.prepareBaseColorFor(url)
    try {
      const load = this.view.webContents.loadURL(url, options)
      // Guard late rejections; waitForUsableLoad still observes them while active.
      load.catch(() => {})
      // Double-rAF = first-paint scripts have run: a visible page answers in ~2 frames
      // instead of the fixed settle; a throttled hidden tab falls back to the fixed wait.
      await waitForUsableLoad(this.view.webContents, load, undefined, undefined, () => this.framePainted())
      // A cross-origin redirect can replace Chromium's frame sink while leaving this attached
      // WebContentsView marked visible. Reasserting the unchanged presentation revives the
      // compositor; without it DOM/CDP remain live while the user sees a blank native surface.
      this.refreshVisibleSurface()
    } catch (error) {
      // Superseded and closing loads abort normally; classify everything else for callers.
      if (isAbortedNavigation(error)) return
      const classified = classifyBrowserError(error, 'navigation-failed')
      this.state = this.navigationFailures.failMessage(this.state, this.liveContents?.getURL(), classified.message, url)
      this.emitState()
      throw classified
    }
  }

  private framePainted(): Promise<void> {
    const probe = this.view.webContents.executeJavaScript(
      'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))',
      true
    )
    return Promise.race([
      probe.then(() => {}),
      new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('paint probe timed out')), PAINT_PROBE_MS))
    ])
  }

  private refreshVisibleSurface(): void {
    refreshVisibleBrowserSurface(this.view, this.bounds, this.visible)
  }

  back(): void {
    this.assertAlive()
    const errorReturnUrl = this.navigationFailures.returnUrl(this.state)
    if (errorReturnUrl) {
      void this.navigate(errorReturnUrl).catch((error: unknown) => this.emit('error', error))
      return
    }
    const history = this.view.webContents.navigationHistory
    if (history.canGoBack()) history.goBack()
  }

  forward(): void {
    this.assertAlive()
    const history = this.view.webContents.navigationHistory
    if (history.canGoForward()) history.goForward()
  }

  reload(): void {
    this.assertAlive()
    if (this.state.navigationError) {
      void this.navigate(this.state.navigationError.url).catch((error: unknown) => this.emit('error', error))
      return
    }
    this.view.webContents.reload()
  }

  // JPEG data URL of the current compositor frame, downscaled to CSS pixels. Null when the
  // view is producing no frames (capturePage resolves with a 0x0 image rather than rejecting).
  async screenshot(): Promise<string | null> {
    this.assertAlive()
    const image = await this.view.webContents.capturePage()
    const size = image.getSize()
    if (size.width === 0 || size.height === 0) return null
    const cssWidth = this.view.getBounds().width
    const normalized = cssWidth > 0 && size.width > cssWidth ? image.resize({ width: cssWidth, quality: 'best' }) : image
    return `data:image/jpeg;base64,${normalized.toJPEG(85).toString('base64')}`
  }

  // Throw immediately if the target is not usable. Cheap and synchronous so it can guard
  // every operation without adding latency.
  private assertAlive(): void {
    if (!this.liveness.alive) {
      throw new BrowserError(this.liveness.category, `Browser tab ${this.id}: ${this.liveness.detail}`)
    }
    const contents = this.view.webContents as WebContents | undefined
    if (!contents || contents.isDestroyed()) {
      this.liveness = { alive: false, category: 'target-closed', detail: 'WebContents destroyed' }
      throw new BrowserError('target-closed', `Browser tab ${this.id}: WebContents destroyed`)
    }
    if (contents.isCrashed()) {
      this.liveness = { alive: false, category: 'target-crashed', detail: 'renderer crashed' }
      throw new BrowserError('target-crashed', `Browser tab ${this.id}: renderer crashed`)
    }
  }

  dispose(): void {
    // Null contents = the tab was destroyed out from under us (page window.close(), renderer
    // teardown); there is nothing left to close, only listeners to drop.
    this.liveContents?.close()
    this.removeAllListeners()
  }

  /**
   * Move the base colour, which is what every compositor gap in this view is filled with.
   *
   * Only ever called at a moment where the change is invisible: while no document is on
   * screen, or under a document that paints its own opaque background over it. Changing it
   * under a page that paints nothing would recolour the page itself.
   */
  private applyBaseColor(color: string): void {
    if (color === this.baseColor) return
    this.baseColor = color
    if (!this.view.webContents.isDestroyed()) this.view.setBackgroundColor(color)
  }

  /**
   * Fill the coming navigation's gap with the colour the destination is about to paint.
   *
   * A site we have seen answers directly. For one we have not, the best available answer is
   * the colour already on screen: holding the outgoing page's colour through the gap reads as
   * the old page persisting a moment longer, which is what Chromium's own paint holding does
   * and is never a flash. Only a tab with nothing on screen falls back to the bezel.
   */
  private prepareBaseColorFor(url: string): void {
    const remembered = this.pageBackgrounds.recall(url)
    if (remembered) this.applyBaseColor(remembered)
    else if (!this.hasDocument) this.applyBaseColor(CHROME_BASE_COLOR)
  }

  /**
   * Read what the new document actually paints and adopt it.
   *
   * Runs at dom-ready — the document's own stylesheets have applied but it has not painted
   * yet — so the correction lands before the first frame rather than as a visible snap after
   * it. A page that paints nothing gets the browser default it was written against; only an
   * opaque measurement is worth remembering for the site.
   */
  private async adoptPageBackground(): Promise<void> {
    this.hasDocument = true
    const contents = this.liveContents
    if (!contents) return
    const probe = await contents.executeJavaScript(PAGE_BACKGROUND_PROBE, true).catch(() => null)
    // A navigation can win the race with this probe; its own dom-ready owns the colour then.
    if (contents.isDestroyed()) return
    const measured = pageBackgroundColor(probe)
    if (!measured) {
      this.applyBaseColor(DEFAULT_PAGE_BASE_COLOR)
      return
    }
    this.pageBackgrounds.remember(contents.getURL(), measured)
    this.applyBaseColor(measured)
  }

  // Native scrollbar styling belongs to the WebContents rather than the React browser chrome.
  // Reapplied after every document navigation: insertCSS is scoped to the current page.
  private applyPageAppearance(): void {
    void this.view.webContents.insertCSS(EMBEDDED_BROWSER_SCROLLBAR_CSS, { cssOrigin: 'user' })
      .catch((error: unknown) => {
        // A navigation or teardown can win this small race; only report for a live tab.
        if (!this.view.webContents.isDestroyed()) this.emit('error', error)
      })
  }

  // A new document drops the favicon; an in-place navigation (hash change, pushState) keeps it.
  private onDidStartNavigation(url: string, isInPlace: boolean, isMainFrame: boolean): void {
    if (isInPlace || !isMainFrame) return
    this.prepareBaseColorFor(url)
    const hadVisibleFailure = this.navigationFailures.start(url, this.state, this.liveContents?.getURL())
    this.state = { ...this.state, navigationError: null }
    if (this.favicon === null && !hadVisibleFailure) return
    this.favicon = null
    this.emitState()
  }

  private attachEvents(): void {
    attachBrowserTabWebContentsEvents({
      tabId: this.id,
      partition: this.partition,
      createPopupTab: this.createPopupTab,
      webContents: this.view.webContents,
      permissionPolicy: () => this.permissionPolicy(),
      history: this.history,
      liveness: () => this.liveness,
      setLiveness: (value) => { this.liveness = value },
      state: () => this.state,
      setState: (value) => { this.state = value },
      favicon: () => this.favicon,
      setFavicon: (value) => { this.favicon = value },
      navigationFailures: this.navigationFailures,
      onDidStartNavigation: (url, isInPlace, isMainFrame) => this.onDidStartNavigation(url, isInPlace, isMainFrame),
      onDidFailLoad: (errno, description, validatedUrl, isMainFrame) => this.onDidFailLoad(errno, description, validatedUrl, isMainFrame),
      emitState: () => this.emitState(),
      refreshState: () => this.refreshState(),
      refreshVisibleSurface: () => this.refreshVisibleSurface(),
      adoptPageBackground: () => this.adoptPageBackground(),
      applyPageAppearance: () => this.applyPageAppearance(),
      back: () => this.back(),
      forward: () => this.forward(),
      reload: () => this.reload(),
      navigate: (url) => this.navigate(url),
      openLinkInNewTab: (request) => this.openLinkInNewTab(request),
      emitError: (error) => this.emit('error', error),
      emitClosed: () => this.emit('closed')
    })
  }

  // Electron nulls WebContentsView.webContents once the contents are destroyed, despite the
  // non-nullable type. Every read not guarded by assertAlive tolerates that so a dead tab can
  // still report a label for the strip until the service reaps it.
  private get liveContents(): WebContents | null {
    const contents = this.view.webContents as WebContents | undefined
    return contents && !contents.isDestroyed() ? contents : null
  }

  private refreshState(): void {
    const contents = this.liveContents
    if (!contents) {
      this.state = { ...this.state, isLoading: false, canGoBack: false, canGoForward: false }
      return
    }
    const history = contents.navigationHistory
    const navigationError = this.state.navigationError
    this.state = {
      url: navigationError?.url ?? (contents.getURL() || this.state.url),
      title: navigationError?.title ?? (contents.getTitle() || this.state.title),
      isLoading: navigationError ? false : contents.isLoading(),
      canGoBack: Boolean(this.navigationFailures.returnUrl(this.state)) || history.canGoBack(),
      canGoForward: history.canGoForward(),
      navigationError
    }
  }

  private onDidFailLoad(errno: number, description: string, validatedUrl: string, isMainFrame: boolean): void {
    const failed = this.navigationFailures.failLoad(this.state, this.liveContents?.getURL(), errno, description, validatedUrl, isMainFrame)
    if (failed) {
      this.state = failed
      this.emitState()
    }
  }

  private emitState(): void {
    this.refreshState()
    this.emit('state', this.state)
  }
}

function sanitizeBounds(bounds: BrowserBounds): BrowserBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  }
}

function normalizeCustomTitle(title: string | null | undefined): string | null {
  if (typeof title !== 'string') return null
  const normalized = title.trim()
  return normalized ? normalized.slice(0, MAX_CUSTOM_TITLE_LENGTH) : null
}
