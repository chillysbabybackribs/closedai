import { app, BrowserWindow, session, type LoadURLOptions, type WebContents } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { BrowserHistory } from './browser-history-store.js'
import type { BrowserBounds, BrowserShot, BrowserState, BrowserTabInfo } from '../shared/types.js'
import { BrowserTab, HOME_URL, PARTITION } from './browser-tab.js'
import { PersistentSessionCookies } from './persistent-session-cookies.js'
import { installRequestHeaderPipeline } from './browser-auth-client-hints.js'
import { installPermissionPolicy } from './browser-permissions.js'
import { TabRenderingPolicy } from './browser-tab-rendering.js'
import { allSettledBounded } from './bounded-concurrency.js'
import { restorePlan, type RestoredTabSession } from './browser-tab-session-store.js'

type BrowserServiceOptions = {
  initialUrl?: string
  // The previous run's tab strip, read from disk before the window exists.
  restore?: RestoredTabSession
}

// How many restored pages load at once. The strip is rebuilt instantly either way; this only
// paces network/renderer startup so a 20-tab restore doesn't spawn 20 renderers in one tick.
const RESTORE_LOAD_CONCURRENCY = 4

// Owns the ordered list of tabs and the single human-visible one. All tabs share one session
// (persist:browser), so a login in one tab applies to all.
export class BrowserService extends EventEmitter {
  private tabs: BrowserTab[] = []
  private activeId: string | null = null
  private disposed = false
  private bounds: BrowserBounds = { x: 0, y: 0, width: 1, height: 1 }
  // True when the browser pane is hidden: the active view is detached from the window's content
  // tree. setVisible(false) alone leaves a sliver on Linux/X11, so we remove it outright.
  private browserDetached = false
  private readonly partitionSession: Electron.Session
  private readonly persistentSessionCookies: PersistentSessionCookies
  // Frames are leased, not free: only the on-screen tab stays in the window's content tree.
  // See browser-tab-rendering.ts for why hiding a view is not enough to stop it rendering.
  private readonly rendering = new TabRenderingPolicy({
    attach: (tabId) => this.attachTabView(tabId),
    detach: (tabId) => this.detachTabView(tabId),
    raiseActive: () => {
      const active = this.active
      if (active && !this.browserDetached) this.attachTabView(active.id)
    }
  })

  constructor(
    private readonly window: BrowserWindow,
    private readonly history: BrowserHistory,
    options: BrowserServiceOptions = {}
  ) {
    super()
    this.on('error', () => {})
    this.partitionSession = session.fromPartition(PARTITION)
    this.configureSession(this.partitionSession)
    this.persistentSessionCookies = new PersistentSessionCookies(this.partitionSession)
    void this.persistentSessionCookies.start().catch((error: unknown) => this.emit('error', error))
    // Window teardown destroys every tab's WebContents BEFORE dispose() runs, and each destroy
    // fires the reap path. Latch here so shutdown never resurrects a home tab into a dying window.
    this.window.once('close', () => { this.disposed = true })
    if (!options.restore || !this.restoreTabs(options.restore)) {
      this.openTab(options.initialUrl ?? HOME_URL, true)
    }
  }

  // ---- Tab management -------------------------------------------------------

  private get active(): BrowserTab | null {
    return this.tabs.find((tab) => tab.id === this.activeId) ?? null
  }

  // Create a tab, add its view to the window, wire its events, and (optionally) make it active.
  private openTab(url: string, activate: boolean, options?: LoadURLOptions): BrowserTab {
    const tab = this.createTab(activate)
    // Fire-and-forget the initial load; an aborted load is swallowed inside navigate(), and
    // anything else routes to the error channel. Activate first so Chromium creates the
    // renderer widget against the current view state.
    tab.start(url, options).catch((error: unknown) => this.emit('error', error))
    return tab
  }

  private createTab(activate: boolean): BrowserTab {
    const tab = new BrowserTab(this.history, (request) => { this.openTab(request.url, request.activate, request.options) })
    this.registerTab(tab)
    if (activate) this.setActive(tab.id)
    else {
      tab.park(this.bounds)
      this.emitTabs()
    }
    return tab
  }

  // Rebuild the previous run's tab strip. Views and labels exist synchronously so the renderer
  // paints the real tabs on its first frame; page loads run bounded, visible tab first.
  private restoreTabs(restored: RestoredTabSession): boolean {
    if (restored.tabs.length === 0) return false
    const plan = restorePlan(restored.tabs.length, restored.activeIndex)
    const tabs = restored.tabs.map((record) => {
      const tab = this.createTab(false)
      tab.seedRestoredState(record.url, record.title)
      return { tab, url: record.url }
    })
    this.setActive(tabs[plan.activeIndex].tab.id)
    void allSettledBounded(plan.loadOrder.map((index) => tabs[index]), RESTORE_LOAD_CONCURRENCY, async ({ tab, url }) => {
      if (!this.tabs.includes(tab)) return
      await tab.start(url)
    }).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') this.emit('error', result.reason)
      }
    })
    return true
  }

  private registerTab(tab: BrowserTab): void {
    tab.on('state', () => {
      // Only the active tab drives the address bar / nav buttons; every tab's state change can
      // still alter its label/spinner in the strip.
      if (tab.id === this.activeId) this.emit('state', tab.getState())
      this.emitTabs()
    })
    tab.on('error', (error: unknown) => this.emit('error', error))
    // The WebContents died without going through closeTab (a page calling window.close()).
    // Reap it exactly like a user close — Chrome's behavior.
    tab.on('closed', () => {
      if (this.disposed || this.window.isDestroyed()) return
      this.closeTab(tab.id)
    })
    this.tabs.push(tab)
    this.rendering.register(tab.id)
  }

  private attachTabView(tabId: string): void {
    const tab = this.tabs.find((candidate) => candidate.id === tabId)
    if (tab) this.window.contentView.addChildView(tab.view)
  }

  private detachTabView(tabId: string): void {
    const tab = this.tabs.find((candidate) => candidate.id === tabId)
    if (!tab) return
    try {
      this.window.contentView.removeChildView(tab.view)
    } catch {
      // Already detached (shutdown, or a close that raced this sync) — nothing to undo.
    }
  }

  newTab(): void {
    this.openTab(HOME_URL, true)
  }

  openNewTab(input: string, activate = true): void {
    this.openTab(input, activate)
  }

  selectTab(id: string): void {
    if (id !== this.activeId) this.setActive(id)
  }

  closeTab(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id)
    if (index === -1) return
    const [tab] = this.tabs.splice(index, 1)
    this.rendering.unregister(id)
    try {
      this.window.contentView.removeChildView(tab.view)
    } catch {
      // View may already be detached during shutdown.
    }
    tab.dispose()
    // If we closed the active tab, activate a neighbor (prefer the one to its right, matching
    // Chrome). Never leave zero tabs — open a fresh home tab instead.
    if (this.activeId === id) {
      this.activeId = null
      const next = this.tabs[index] ?? this.tabs[index - 1] ?? null
      if (next) this.setActive(next.id)
      else this.openTab(HOME_URL, true)
    } else {
      this.emitTabs()
    }
  }

  private setActive(id: string): void {
    const next = this.tabs.find((tab) => tab.id === id)
    if (!next) return
    for (const tab of this.tabs) {
      if (tab.id !== id) tab.hide()
    }
    this.activeId = id
    this.rendering.setActive(id)
    if (!this.browserDetached) {
      // Re-add the active view so it becomes the topmost child (Electron reorders an
      // already-present view to the top on re-add).
      this.attachTabView(next.id)
      next.applyBounds(this.bounds, true)
    }
    this.emit('state', next.getState())
    this.emitTabs()
  }

  private tabInfos(): BrowserTabInfo[] {
    // `pos` is derived here and nowhere else: this.tabs IS the strip order.
    return this.tabs.map((tab, index) => {
      const state = tab.getState()
      return {
        id: tab.id,
        pos: index + 1,
        title: state.title,
        url: state.url,
        favicon: tab.getFavicon(),
        isLoading: state.isLoading,
        active: tab.id === this.activeId
      }
    })
  }

  private emitTabs(): void {
    this.emit('tabs', this.tabInfos())
  }

  // ---- Delegated per-tab operations (act on the active tab) -----------------

  setBounds(bounds: BrowserBounds): void {
    this.bounds = bounds
    const show = bounds.visible !== false
    const active = this.active
    if (!show && !this.browserDetached) {
      this.browserDetached = true
      this.rendering.setPaneVisible(false)
      return
    }
    if (show && this.browserDetached) {
      this.browserDetached = false
      this.rendering.setPaneVisible(true)
    }
    active?.applyBounds(bounds, show)
  }

  async navigate(input: string): Promise<void> {
    await this.requireActive().navigate(input)
  }

  // ---- Tool access (browser-page-access.ts) --------------------------------

  tabList(): BrowserTabInfo[] {
    return this.tabInfos()
  }

  /** Live WebContents of a tab (the active one when omitted); null if unknown or destroyed. */
  contentsOf(tabId?: string): WebContents | null {
    const tab = tabId ? this.tabs.find((candidate) => candidate.id === tabId) ?? null : this.active
    const contents = tab?.view.webContents
    return contents && !contents.isDestroyed() ? contents : null
  }

  /** Keep a tab's compositor attached while a frame-dependent tool operates on it. */
  leaseTabRendering(tabId: string): (() => void) | null {
    if (!this.tabs.some((tab) => tab.id === tabId)) return null
    return this.rendering.pin(tabId)
  }

  /** Navigate the active tab, or a new active tab, and resolve with the tab id once usable. */
  async navigateTab(input: string, newTab: boolean): Promise<string> {
    const tab = newTab ? this.createTab(true) : this.requireActive()
    await tab.navigate(input)
    return tab.id
  }

  back(): void {
    this.requireActive().back()
  }

  forward(): void {
    this.requireActive().forward()
  }

  reload(): void {
    this.requireActive().reload()
  }

  snapshot(): BrowserState {
    return this.active?.getState() ??
      { url: 'about:blank', title: 'New Tab', isLoading: false, canGoBack: false, canGoForward: false }
  }

  // Full state for renderer mount: constructor emits precede IPC and reloads have no history,
  // so the UI pulls once instead of waiting for another navigation.
  browserSnapshot(): { state: BrowserState; tabs: BrowserTabInfo[] } {
    return { state: this.snapshot(), tabs: this.tabInfos() }
  }

  // A still of the active tab for the renderer's overlay freeze (the native view composites
  // above the DOM, so a shelf or dialog shows this image while the live view is detached).
  async capture(): Promise<BrowserShot | null> {
    const tab = this.active
    if (!tab) return null
    const imageUrl = await tab.screenshot().catch(() => null)
    if (!imageUrl) return null
    const state = tab.getState()
    return { imageUrl, tabId: tab.id, url: state.url, title: state.title }
  }

  // Best omnibox inline-completion for the current input, or null if none.
  suggest(input: string): { completion: string; url: string } | null {
    return this.history.suggest(input)
  }

  dispose(): void {
    this.disposed = true
    this.persistentSessionCookies.dispose()
    this.rendering.dispose()
    for (const tab of this.tabs) {
      try {
        this.window.contentView.removeChildView(tab.view)
      } catch {
        // Already detached during shutdown.
      }
      tab.dispose()
    }
    this.tabs = []
    this.activeId = null
  }

  async flushSessionData(): Promise<void> {
    await this.persistentSessionCookies.flush()
  }

  private requireActive(): BrowserTab {
    const tab = this.active
    if (!tab) throw new Error('No active browser tab')
    return tab
  }

  private configureSession(partitionSession: Electron.Session): void {
    // Normalize wire identity (strip the embedder tokens from the UA, Google auth client hints).
    installRequestHeaderPipeline(partitionSession, app.getName())
    installPermissionPolicy(partitionSession)
    // Persistent V8 code cache, as Chrome keeps for every profile.
    partitionSession.setCodeCachePath(join(app.getPath('userData'), 'code-cache'))
  }
}
