import { WebContentsView, session, type LoadURLOptions, type WebContents } from 'electron'
import { EventEmitter } from 'node:events'
import type { BrowserHistory } from './browser-history-store.js'
import type { BrowserBounds, BrowserState } from '../shared/types.js'
import { normalizeUrl, isAbortedNavigation, PARTITION } from './browser-url.js'
import { BrowserError, classifyBrowserError, isRendererGoneReason } from './browser-error.js'
import { waitForUsableLoad } from './browser-navigation-wait.js'
import { selectFavicon } from './browser-favicon.js'
import { EMBEDDED_BROWSER_SCROLLBAR_CSS } from './browser-page-style.js'
import { installTabZoom } from './browser-tab-zoom.js'
import type { PopupTabRequest } from './browser-popup-policy.js'
import { installPopupBridge } from './browser-popup-bridge.js'
import { installContentsPermissionPolicy } from './browser-permissions.js'
import { showBrowserContextMenu } from './browser-context-menu.js'
import { cookieImportTargetFor, refreshCookiesForUrl } from './cookie-refresh.js'
import { BrowserNavigationFailureState } from './browser-navigation-failure-state.js'
import {
  CHROME_BASE_COLOR,
  DEFAULT_PAGE_BASE_COLOR,
  PAGE_BACKGROUND_PROBE,
  PageBackgroundMemory,
  pageBackgroundColor
} from './browser-page-background.js'
import { browserOccludedBounds, refreshVisibleBrowserSurface } from './browser-surface-visibility.js'
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
const PAINT_PROBE_MS = 1_000
const MAX_CUSTOM_TITLE_LENGTH = 300

let nextTabId = 1

type TabLiveness =
  | { alive: true }
  | { alive: false; category: 'target-closed' | 'target-crashed'; detail: string }

export class BrowserTab extends EventEmitter {
  readonly id = `tab-${nextTabId++}`
  readonly view: WebContentsView
  private bounds: BrowserBounds = hiddenBounds
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
    private readonly registerNativePopup: (contents: WebContents) => void = () => {},
    // Shared across the window's tabs: a page's canvas colour belongs to the site, not to
    // whichever view happened to load it first.
    private readonly pageBackgrounds: PageBackgroundMemory = new PageBackgroundMemory()
  ) {
    super()
    // Node throws on unhandled 'error'; the service subscribes, but keep a no-op fallback.
    this.on('error', () => {})
    this.view = new WebContentsView({
      webPreferences: {
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

  // The first real navigation IS the bootstrap; no about:blank preload.
  start(url: string, options?: LoadURLOptions): Promise<void> {
    return this.navigate(url, options)
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
    this.bounds = sanitizeBounds(bounds)
    this.visible = show && this.bounds.width > 1 && this.bounds.height > 1
    if (!show && bounds.occluded === true && this.bounds.width > 1 && this.bounds.height > 1) {
      // Keep the loaded native surface visible and full-sized so Chromium continues producing
      // frames. The renderer's freeze still covers the browser box while this view sits beyond
      // it; restoring the real bounds therefore avoids the setVisible(false/true) blanking bug.
      this.view.setBounds(browserOccludedBounds(this.bounds))
      this.view.setVisible(true)
      return
    }
    this.view.setBounds(this.keepRealSurface() ? this.bounds : hiddenBounds)
    this.view.setVisible(this.visible)
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
    this.view.setBounds(this.bounds.width > 1 ? this.bounds : hiddenBounds)
  }

  // Park a freshly created background tab at the pane's real bounds so its first layout
  // is honest even though it has never been shown.
  park(bounds: BrowserBounds): void {
    if (bounds.width <= 1 || bounds.height <= 1) return
    this.bounds = sanitizeBounds(bounds)
    this.visible = false
    this.view.setVisible(false)
    this.view.setBounds(this.bounds)
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
    const contents = this.view.webContents
    // Authoritative liveness signals. `render-process-gone` fires for every renderer-loss
    // reason (crash, oom, killed, …); a clean-exit is not a crash, everything else is.
    contents.on('render-process-gone', (_event, details) => {
      const reason = details?.reason ?? 'crashed'
      if (isRendererGoneReason(reason)) {
        this.liveness = { alive: false, category: 'target-crashed', detail: `renderer ${reason}` }
        this.emit('error', new BrowserError('target-crashed', `Browser tab ${this.id}: renderer ${reason}`))
      }
    })
    contents.on('destroyed', () => {
      this.liveness = { alive: false, category: 'target-closed', detail: 'WebContents destroyed' }
      // Destruction we did not initiate (a page calling window.close(), renderer teardown)
      // must reap the tab like any other close; our own dispose() drops listeners first.
      this.emit('closed')
    })
    contents.on('unresponsive', () => {
      // Not fatal — the renderer may recover, so liveness is not latched.
      this.emit('error', new BrowserError('target-unresponsive', `Browser tab ${this.id}: renderer unresponsive`))
    })
    // A page's beforeunload handler would otherwise pop a native "Leave site?" modal that
    // blocks window close / navigation. Always allow the unload.
    contents.on('will-prevent-unload', (event) => {
      event.preventDefault()
    })
    contents.on('did-start-loading', () => {
      this.state = { ...this.state, isLoading: true }
      this.emitState()
    })
    contents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      this.onDidStartNavigation(url, isInPlace, isMainFrame)
    })
    contents.on('did-stop-loading', () => {
      this.refreshState()
      this.emitState()
      // Covers user/page/history navigations that do not pass through navigate(), and pages
      // whose subresources outlive the earlier usable-load checkpoint.
      this.refreshVisibleSurface()
    })
    // Before the new document's first paint: the one moment where correcting the base colour
    // is free. did-finish-load repeats it because a late stylesheet or a theme script can
    // change the canvas after dom-ready.
    contents.on('dom-ready', () => {
      void this.adoptPageBackground()
    })
    contents.on('did-finish-load', () => {
      this.applyPageAppearance()
      void this.adoptPageBackground()
    })
    // Alt+wheel page zoom; owns its own input-event and did-finish-load listeners.
    installTabZoom(contents)
    installContentsPermissionPolicy(contents)
    contents.on('page-title-updated', () => {
      this.refreshState()
      this.history.updateTitle(this.state.url, this.state.title)
      this.emitState()
    })
    contents.on('page-favicon-updated', (_event, favicons) => {
      const next = selectFavicon(favicons)
      if (next) this.history.updateFavicon?.(contents.getURL(), next)
      if (next === this.favicon) return
      this.favicon = next
      this.emitState()
    })
    contents.on('did-navigate', () => {
      // A successful top-level navigation means the renderer is live again — clear a prior
      // crash latch so reload-after-crash recovers. (A destroyed WebContents never navigates.)
      if (!this.liveness.alive && this.liveness.category === 'target-crashed' && !contents.isDestroyed()) {
        this.liveness = { alive: true }
      }
      this.state = this.navigationFailures.succeed(this.state)
      this.refreshState()
      this.history.record(this.state.url, this.state.title)
      this.emitState()
    })
    contents.on('did-fail-load', (_event, errno, description, validatedUrl, isMainFrame) =>
      this.onDidFailLoad(errno, description, validatedUrl, isMainFrame))
    contents.on('did-navigate-in-page', () => {
      this.refreshState()
      this.emitState()
    })
    contents.on('context-menu', (_event, params) => {
      // Native view right-clicks stay in main and delegate navigation to guarded tab methods.
      showBrowserContextMenu(contents, params, {
        back: () => this.back(),
        forward: () => this.forward(),
        reload: () => this.reload(),
        canGoBack: () => contents.navigationHistory.canGoBack(),
        canGoForward: () => contents.navigationHistory.canGoForward(),
        openUrl: (url) => { void this.navigate(url).catch((error: unknown) => this.emit('error', error)) },
        openUrlInNewTab: (url) => this.openLinkInNewTab({ url, activate: false }),
        siteCookieImport: () => {
          const target = cookieImportTargetFor(contents.getURL())
          return target ? { domain: target.domain, source: target.source.name } : null
        },
        importSiteCookies: () => {
          // Reload on completion so the page re-requests with the imported session.
          void refreshCookiesForUrl(session.fromPartition(PARTITION), contents.getURL())
            .then(() => this.reload())
            .catch((error: unknown) => this.emit('error', error))
        }
      })
    })
    installPopupBridge(contents, this.partition, this.openLinkInNewTab, this.registerNativePopup)
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
