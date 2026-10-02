import { app, BrowserWindow, desktopCapturer, session, type LoadURLOptions, type WebContents, type WebContentsViewConstructorOptions } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { BrowserHistory } from './browser-history-store.js'
import type { BrowserBounds, BrowserShot, BrowserState, BrowserTabInfo, VideoCompareState } from '../shared/types.js'
import type { TabPersistRecord } from './browser-tab-session-store.js'
import { allocateTabId, BrowserTab, HOME_URL, PARTITION } from './browser-tab.js'
import { ImageTab } from './local-files/image-tab.js'
import { FileTab } from './local-files/file-tab.js'
import { VideoTab } from './local-files/video-tab.js'
import { VideoHubTab, VIDEO_HUB_KEY } from './local-files/video-hub-tab.js'
import { searchVideoLibrary, type VideoLibraryEntry } from './local-files/video-library.js'
import { isRenderableFile, type FileTabContent, type FileView, type ImageTabContent, type VideoTabContent } from '../shared/local-files.js'
import { PersistentSessionCookies } from './persistent-session-cookies.js'
import { BrowserObservers } from './browser-network/observers.js'
import { describeMissingTab } from '../shared/browser-tabs.js'
import { installPermissionPolicy, type PermissionPolicyDeps } from './browser-permissions.js'
import { TabRenderingPolicy } from './browser-tab-rendering.js'
import { TabCadencePolicy, webContentsCadence } from './browser-tab-cadence.js'
import type { RestoredTabSession } from './browser-tab-session-store.js'
import { restoreBrowserTabs } from './browser-service-restore.js'
import {
  duplicateSpecialTab, openFilePageTab, openFileViewerTab, openImageTab, openVideoTab, pageTabShowing, swapFileView, type FileViewHost
} from './browser-service-special-tabs.js'
import { prepareBrowserTabForTool } from './browser-tab-surface-prep.js'
import { browserPaneBounds, browserSurfaceVisibility } from './browser-surface-visibility.js'
import { settleFrames } from './browser-frame-settle.js'
import { PageBackgroundMemory } from './browser-page-background.js'
import {
  closeBrowserTab,
  closeBrowserTabsToRight,
  closeOtherBrowserTabs,
  parkWebBrowserTabs,
  retireBrowserTab,
  setBrowserActiveTab,
  type BrowserServiceTabOpsHost
} from './browser-service-tab-ops.js'
import type { CdpBrowserTarget } from './cdp/browser-cdp-access.js'

type BrowserServiceOptions = {
  initialUrl?: string
  // The previous run's tab strip, read from disk before the window exists.
  restore?: RestoredTabSession
  // Settings → Security web permission policy and the chrome that asks; absent means allow-all.
  permissions?: Pick<PermissionPolicyDeps, 'policy' | 'ask'>
  /**
   * Work the first page load must not race — the one-shot cookie import, which decides
   * whether a restored or home page arrives signed in. The window, and with it the chat
   * UI, paints while this settles instead of waiting behind it.
   */
  readyToLoad?: Promise<unknown>
}

// How long a reveal waits for the page's first frame before showing it anyway. A parked page
// keeps painting at the pane's size, so a live one answers in one or two frames; the bound only
// keeps a page that will never paint (a throttled or crashed renderer) from holding the
// renderer's still on screen.
const REVEAL_SETTLE_MS = 400
// The same bound for a still: a capture is worth a couple of frames' wait, never a stall.
const CAPTURE_SETTLE_MS = 250

// Owns the ordered list of tabs and the single human-visible one. All tabs share one session
// (persist:browser), so a login in one tab applies to all.
export class BrowserService extends EventEmitter {
  private tabs: (BrowserTab | ImageTab | FileTab | VideoTab | VideoHubTab)[] = []
  private videoRecents: VideoLibraryEntry[] = []
  private activeId: string | null = null
  private disposed = false
  private bounds: BrowserBounds = { x: 0, y: 0, width: 1, height: 1 }
  // Whether the active page's pixels were on screen at the last bounds report, so a return
  // from behind app chrome can be distinguished from an ordinary resize.
  private pageVisible = true
  private boundsRevision = 0
  private videoCompare: VideoCompareState | null = null
  private overlayCapture: Promise<BrowserShot | null> | null = null
  // One colour memory for the whole window: what a site paints is a property of the site.
  // See browser-page-background.ts for what it buys.
  private readonly pageBackgrounds = new PageBackgroundMemory()
  private readonly partitionSession: Electron.Session
  private readonly permissions: Pick<PermissionPolicyDeps, 'policy' | 'ask'>
  private readonly persistentSessionCookies: PersistentSessionCookies
  // What the app records about every tab without a debugger: network traffic and rules on
  // the session, console output per tab. Exposed to the model tools through the access classes.
  readonly observers = new BrowserObservers((webContentsId) => this.tabIdForContents(webContentsId))
  // User tabs remain resident to preserve their compositor; other surfaces lease frames.
  private readonly rendering = new TabRenderingPolicy({
    attach: (tabId) => this.attachTabView(tabId),
    detach: (tabId) => this.detachTabView(tabId),
    raiseActive: () => {
      const active = this.active
      if (active && this.bounds.visible !== false) this.attachTabView(active.id)
    }
  })
  // A hidden tab runs at ~1 Hz with no animation frames; a page under tool control needs real
  // cycles to finish loading itself. See browser-tab-cadence.ts for the measurement.
  private readonly cadence = new TabCadencePolicy(webContentsCadence({
    contents: (tabId) => {
      const tab = this.tabs.find((candidate) => candidate.id === tabId)
      return tab instanceof BrowserTab ? tab.view.webContents : null
    },
    onScreen: (tabId) => tabId === this.activeId && browserSurfaceVisibility(this.bounds).pageVisible
  }))

  constructor(
    private readonly window: BrowserWindow,
    private readonly history: BrowserHistory,
    options: BrowserServiceOptions = {}
  ) {
    super()
    this.on('error', () => {})
    this.permissions = options.permissions ?? { policy: () => 'allow', ask: async () => true }
    this.partitionSession = session.fromPartition(PARTITION)
    this.configureSession(this.partitionSession)
    this.persistentSessionCookies = new PersistentSessionCookies(this.partitionSession)
    void this.persistentSessionCookies.start().catch((error: unknown) => this.emit('error', error))
    // Window teardown destroys every tab's WebContents BEFORE dispose() runs, and each destroy
    // fires the reap path. Latch here so shutdown never resurrects a home tab into a dying window.
    this.window.once('close', () => { this.disposed = true })
    const openInitialTabs = (): void => {
      if (this.disposed) return
      if (!options.restore || !this.restoreSession(options.restore)) {
        this.openTab(options.initialUrl ?? HOME_URL, true)
      }
    }
    if (options.readyToLoad) void options.readyToLoad.then(openInitialTabs, openInitialTabs)
    else openInitialTabs()
  }

  // ---- Tab management -------------------------------------------------------

  private get active(): BrowserTab | ImageTab | FileTab | VideoTab | VideoHubTab | null {
    return this.tabs.find((tab) => tab.id === this.activeId) ?? null
  }

  // Create a tab, add its view to the window, wire its events, and (optionally) make it active.
  private openTab(url: string, activate: boolean, options?: LoadURLOptions, index?: number): BrowserTab {
    const tab = this.createTab(activate, index)
    // Fire-and-forget the initial load; an aborted load is swallowed inside navigate(), and
    // anything else routes to the error channel. Activate first so Chromium creates the
    // renderer widget against the current view state.
    tab.start(url, options).catch((error: unknown) => this.emit('error', error))
    return tab
  }

  private createTab(activate: boolean, index?: number, id?: string, popupOptions?: WebContentsViewConstructorOptions): BrowserTab {
    const tab = new BrowserTab(
      this.history,
      (request) => {
        const child = this.openTab(request.url, request.activate, request.options)
        this.emit('popup', tab.id, child.id)
      },
      PARTITION,
      (options, request) => {
        const child = this.createTab(request.activate && this.activeId === tab.id, undefined, undefined, options)
        this.emit('popup', tab.id, child.id)
        // Chromium navigates adopted children itself. Background-tab opens may not supply
        // WebContents; only that deferred case needs an explicit initial navigation.
        if (!options.webContents) {
          void child.start(request.url, request.options).catch((error: unknown) => this.emit('error', error))
        }
        return child.view.webContents
      },
      this.pageBackgrounds,
      id,
      popupOptions
    )
    tab.permissionPolicy = this.permissions.policy
    if (!activate) tab.applyBounds({ ...this.bounds, occluded: true }, false)
    this.observers.watchTab(tab.id, tab.view.webContents)
    this.registerTab(tab, index)
    if (activate) this.setActive(tab.id)
    else {
      tab.applyBounds({ ...this.bounds, occluded: true }, false)
      this.emitTabs()
    }
    return tab
  }

  private restoreSession(restored: RestoredTabSession): boolean {
    return restoreBrowserTabs({
      window: this.window,
      tabs: this.tabs,
      disposed: this.disposed,
      createTab: (activate, index, id) => this.createTab(activate, index, id),
      setActive: (id) => { this.setActive(id) },
      emitError: (error) => { this.emit('error', error) },
      startTab: (tab, url, options, stack) => tab.start(url, options, stack)
    }, restored)
  }

  private registerTab(tab: BrowserTab | ImageTab | FileTab | VideoTab | VideoHubTab, index?: number): void {
    tab.on('state', () => {
      // Only the active tab drives the address bar / nav buttons; every tab's state change can
      // still alter its label/spinner in the strip.
      if (tab.id === this.activeId) this.emit('state', this.enrichState(tab.getState()))
      this.emitTabs()
    })
    tab.on('error', (error: unknown) => this.emit('error', error))
    // The WebContents died without going through closeTab (a page calling window.close()).
    // Reap it exactly like a user close — Chrome's behavior.
    tab.on('closed', () => {
      if (this.disposed || this.window.isDestroyed()) return
      this.closeTab(tab.id)
    })
    const insertAt = typeof index === 'number' ? Math.min(Math.max(index, 0), this.tabs.length) : this.tabs.length
    this.tabs.splice(insertAt, 0, tab)
    // Electron can blank a WebContentsView after remove/re-add. User tabs stay resident across
    // tab switches AND pane hiding; setVisible controls display without tearing down attachment.
    if (tab instanceof BrowserTab) this.rendering.register(tab.id, { resident: true })
  }

  private attachTabView(tabId: string): void {
    const tab = this.tabs.find((candidate) => candidate.id === tabId)
    if (!(tab instanceof BrowserTab)) return
    this.window.contentView.addChildView(tab.view)
  }

  private detachTabView(tabId: string): void {
    const tab = this.tabs.find((candidate) => candidate.id === tabId)
    if (!(tab instanceof BrowserTab)) return
    try {
      this.window.contentView.removeChildView(tab.view)
    } catch {
      // Already detached (shutdown, or a close that raced this sync) — nothing to undo.
    }
  }

  newTab(): void {
    this.openTab(HOME_URL, true)
  }

  newTabToRight(id: string, activate = true): void {
    const index = this.tabs.findIndex((tab) => tab.id === id)
    if (index === -1) return
    this.openTab(HOME_URL, activate, undefined, index + 1)
  }

  openNewTab(input: string, activate = true): string {
    return this.openTab(input, activate).id
  }

  openImage(content: ImageTabContent): string {
    return openImageTab(this.tabs, this.activeId, content, (tab, index) => { this.registerTab(tab, index) },
      (id) => { this.setActive(id) }, (state) => { this.emit('state', state) })
  }

  openVideo(content: VideoTabContent): string {
    const id = openVideoTab(this.tabs, this.activeId, content, (tab, index) => { this.registerTab(tab, index) },
      (id) => { this.setActive(id) }, (state) => { this.emit('state', state) })
    void import('node:fs/promises').then(({ stat }) => stat(content.path)).then((info) => {
      if (info.isFile()) this.rememberVideo(content.path, content.name, info.size, info.mtimeMs)
    }).catch(() => { this.rememberVideo(content.path, content.name, 0, Date.now()) })
    return id
  }

  openVideoHub(): string {
    const existing = this.tabs.find((tab): tab is VideoHubTab => tab instanceof VideoHubTab)
    if (existing) {
      this.setActive(existing.id)
      return existing.id
    }
    const tab = new VideoHubTab(allocateTabId(), VIDEO_HUB_KEY, this.activeId)
    this.registerTab(tab)
    this.setActive(tab.id)
    return tab.id
  }

  videoRecentList(): VideoLibraryEntry[] {
    return [...this.videoRecents]
  }

  searchVideos(query: string): Promise<VideoLibraryEntry[]> {
    const roots: string[] = []
    try { roots.push(app.getPath('downloads')) } catch { /* ignore */ }
    try { roots.push(app.getPath('videos')) } catch { /* ignore */ }
    return searchVideoLibrary(roots, query)
  }

  private rememberVideo(path: string, name: string, bytes: number, modifiedMs: number): void {
    const entry: VideoLibraryEntry = { path, name, bytes, modifiedMs }
    this.videoRecents = [entry, ...this.videoRecents.filter((item) => item.path !== path)].slice(0, 20)
  }

  openFileTab(content: { path: string; name: string; line?: number; endLine?: number; cwd?: string; diff?: string }): string {
    // A line or diff link into HTML/SVG shown as its page turns that tab to code rather than adding one.
    const page = pageTabShowing(this.tabs, content.path)
    if (page && isRenderableFile(content.path)) this.setFileView(page.id, 'code')
    return openFileViewerTab(this.tabs, this.activeId, content, (tab, index) => { this.registerTab(tab, index) },
      (id) => { this.setActive(id) }, (state) => { this.emit('state', state) })
  }

  openFilePage(path: string): string {
    return openFilePageTab(this.fileViewHost(), path)
  }

  /** Show a local HTML or SVG tab as its rendered page or as its source, keeping its id and slot. */
  setFileView(id: string, view: FileView): void {
    swapFileView(this.fileViewHost(), id, view)
  }

  private fileViewHost(): FileViewHost {
    return {
      tabs: this.tabs,
      activeId: this.activeId,
      retire: (tab) => { retireBrowserTab(this.tabOpsHost(), tab) },
      register: (tab, index) => { this.registerTab(tab, index) },
      openPage: (url, activate, index, id) => {
        const tab = this.createTab(activate, index, id)
        tab.start(url).catch((error: unknown) => this.emit('error', error))
        return tab
      },
      setActive: (id) => { this.setActive(id) },
      emitTabs: () => { this.emitTabs() }
    }
  }

  fileContent(id: string): Promise<FileTabContent> {
    const tab = this.tabs.find((item) => item.id === id)
    if (!(tab instanceof FileTab)) throw new Error('This file tab is no longer open.')
    return tab.readContent()
  }

  imageContent(id: string): ImageTabContent {
    const tab = this.tabs.find((item) => item.id === id)
    if (!(tab instanceof ImageTab)) throw new Error('This image tab is no longer open.')
    return tab.content
  }

  async videoContent(id: string): Promise<VideoTabContent> {
    const tab = this.tabs.find((item) => item.id === id)
    if (!(tab instanceof VideoTab)) throw new Error('This video tab is no longer open.')
    const identity = tab.getState().video!
    const { stat } = await import('node:fs/promises')
    const info = await stat(identity.path).catch(() => null)
    return {
      name: identity.name,
      path: identity.path,
      src: tab.content.src,
      revision: identity.revision,
      ...(info?.isFile() ? { bytes: info.size } : {})
    }
  }

  startVideoCompare(otherTabId: string): void {
    const active = this.active
    if (!(active instanceof VideoTab)) throw new Error('Select a video tab to compare.')
    const other = this.tabs.find((candidate) => candidate.id === otherTabId)
    if (!(other instanceof VideoTab)) throw new Error('Compare only works with another open video tab.')
    if (other.id === active.id) throw new Error('Pick a different video tab.')
    this.videoCompare = { tabIds: [active.id, other.id], syncPlay: false, audioTabId: active.id }
    this.emitBrowserState()
  }

  clearVideoCompare(): void {
    if (!this.videoCompare) return
    this.videoCompare = null
    this.emitBrowserState()
  }

  setVideoCompareSync(enabled: boolean): void {
    if (!this.videoCompare) return
    this.videoCompare = { ...this.videoCompare, syncPlay: enabled }
    this.emitBrowserState()
  }

  setVideoCompareAudio(tabId: string): void {
    if (!this.videoCompare?.tabIds.includes(tabId)) throw new Error('That video is not in the compare view.')
    this.videoCompare = { ...this.videoCompare, audioTabId: tabId }
    this.emitBrowserState()
  }

  private enrichState(state: BrowserState): BrowserState {
    const compare = this.validVideoCompare()
    return { ...state, videoCompare: compare }
  }

  private validVideoCompare(): VideoCompareState | null {
    if (!this.videoCompare) return null
    const [left, right] = this.videoCompare.tabIds
    const open = (id: string): boolean => {
      const tab = this.tabs.find((candidate) => candidate.id === id)
      return tab instanceof VideoTab
    }
    if (!open(left) || !open(right)) {
      this.videoCompare = null
      return null
    }
    const audioTabId = this.videoCompare.tabIds.includes(this.videoCompare.audioTabId)
      ? this.videoCompare.audioTabId
      : left
    return { ...this.videoCompare, audioTabId }
  }

  private emitBrowserState(): void {
    const active = this.active
    if (active) this.emit('state', this.enrichState(active.getState()))
    else this.emitTabs()
  }

  /** Drop compare state when a compared tab closes. */
  sanitizeVideoCompare(closedId: string): void {
    if (!this.videoCompare?.tabIds.includes(closedId)) return
    this.videoCompare = null
    this.emitBrowserState()
  }

  selectTab(id: string): void {
    if (id !== this.activeId) this.setActive(id)
  }

  closeTab(id: string): void {
    closeBrowserTab(this.tabOpsHost(), id)
  }

  closeOtherTabs(id: string): void {
    closeOtherBrowserTabs(this.tabOpsHost(), id)
  }

  closeTabsToRight(id: string): void {
    closeBrowserTabsToRight(this.tabOpsHost(), id)
  }

  duplicateTab(id: string, activate = true): void {
    const index = this.tabs.findIndex((tab) => tab.id === id)
    const tab = index === -1 ? null : this.tabs[index]
    if (!tab) return
    if (duplicateSpecialTab(this.tabs, id, this.activeId, activate, (duplicate, at) => { this.registerTab(duplicate, at) },
      (activeId) => { this.setActive(activeId) }, () => { this.emitTabs() })) return
    const state = tab.getState()
    const duplicate = this.openTab(state.url, activate, undefined, index + 1)
    duplicate.rename(tab.getCustomTitle())
  }

  reloadTab(id: string): void {
    const tab = this.tabs.find((candidate) => candidate.id === id)
    tab?.reload()
  }

  renameTab(id: string, title: string | null): void {
    const tab = this.tabs.find((candidate) => candidate.id === id)
    tab?.rename(title)
  }

  private setActive(id: string): void {
    setBrowserActiveTab(this.tabOpsHost(), id)
  }

  private tabInfos(): BrowserTabInfo[] {
    return this.persistTabs().map(({ stack: _stack, ...info }) => info)
  }

  /** Strip metadata plus navigation stacks for session persistence. */
  persistTabs(): TabPersistRecord[] {
    // `pos` is derived here and nowhere else: this.tabs IS the strip order.
    return this.tabs.map((tab, index) => {
      const state = tab.getState()
      return {
        id: tab.id,
        pos: index + 1,
        title: tab.getCustomTitle() ?? state.title,
        customTitle: tab.getCustomTitle(),
        url: state.url,
        favicon: tab.getFavicon(),
        isLoading: state.isLoading,
        active: tab.id === this.activeId,
        ...(state.image ? { image: state.image } : {}),
        ...(state.video ? { video: state.video } : {}),
        ...(state.videoHub ? { videoHub: state.videoHub } : {}),
        ...(state.file ? { file: state.file } : {}),
        stack: tab.exportNavigationStack()
      }
    })
  }

  private emitTabs(): void {
    this.emit('tabs', this.tabInfos())
  }

  // ---- Delegated per-tab operations (act on the active tab) -----------------

  async setBounds(bounds: BrowserBounds): Promise<void> {
    const revision = ++this.boundsRevision
    const next = browserPaneBounds(this.bounds, bounds)
    const { paneVisible, pageVisible } = browserSurfaceVisibility(next)
    if (paneVisible && !pageVisible && this.pageVisible) {
      // Renderer rAFs are paint opportunities, not acknowledgement from the compositor.
      // Copy its submitted frame before uncovering it: this flushes the still's actual pixels
      // even when the app renderer is busy. A DOM/decode check alone can miss a one-frame gap.
      await this.window.webContents.capturePage()
      // Closing/reopening or resizing can overtake the asynchronous frame copy. An obsolete
      // occlusion must never park the page after a newer restore has already completed.
      if (revision !== this.boundsRevision || this.disposed) return
    }
    this.bounds = next
    const revealing = pageVisible && !this.pageVisible
    this.pageVisible = pageVisible
    const active = this.active
    this.rendering.setPaneVisible(paneVisible)
    if (active instanceof ImageTab || active instanceof FileTab || active instanceof VideoTab || active instanceof VideoHubTab) {
      parkWebBrowserTabs(this.tabOpsHost())
      return
    }
    if (!paneVisible) {
      // Hide display and restore background throttling without removing resident views. The
      // same attachment is needed when the pane returns; reattachment can leave a blank page.
      for (const tab of this.tabs) {
        if (!(tab instanceof BrowserTab)) continue
        tab.hide()
        const contents = tab.view.webContents
        if (!contents.isDestroyed()) contents.setBackgroundThrottling(true)
      }
      return
    }
    if (active instanceof BrowserTab) {
      const contents = active.view.webContents
      if (!contents.isDestroyed() && pageVisible) contents.setBackgroundThrottling(false)
    }
    active?.applyBounds(this.bounds, pageVisible)
    // The renderer holds its freeze still until this call resolves. Returning the moment the
    // view is made visible drops the still onto a surface that has not painted yet, which is
    // the blank the still existed to cover; wait for the frame instead.
    if (revealing && active && !active.view.webContents.isDestroyed()) {
      await settleFrames(active.view.webContents, REVEAL_SETTLE_MS)
    }
  }

  async navigate(input: string): Promise<void> {
    await this.requireActive().navigate(input)
  }

  // ---- Tool access (browser-page-access.ts) --------------------------------

  tabList(): BrowserTabInfo[] {
    return this.tabInfos()
  }

  /** Every page-requested window is a regular tab and uses the same tool access. */
  cdpTargetList(): CdpBrowserTarget[] {
    const tabs = this.tabInfos().filter((tab) => !tab.image && !tab.file && !tab.video).map((tab) => ({ ...tab, kind: 'tab' as const }))
    return tabs
  }

  /** The session every tab shares; what the model's session-level tools operate on. */
  get session(): Electron.Session {
    return this.partitionSession
  }

  /** The tab id behind a WebContents id; null for session-only traffic. */
  tabIdForContents(webContentsId: number | undefined): string | null {
    if (webContentsId === undefined) return null
    const tab = this.tabs.find((candidate) => candidate instanceof BrowserTab && candidate.view.webContents.id === webContentsId)
    if (tab) return tab.id
    return null
  }

  /**
   * Size a tab's native surface to an emulated viewport, or null to fill the pane again.
   * False when the tab is unknown. See BrowserTab.setEmulatedViewport for why the surface has
   * to move rather than the protocol override alone.
   */
  setEmulatedViewport(tabId: string | undefined, size: { width: number; height: number } | null): boolean {
    const tab = tabId ? this.tabs.find((candidate) => candidate.id === tabId) ?? null : this.active
    if (!(tab instanceof BrowserTab)) return false
    tab.setEmulatedViewport(size)
    return true
  }

  /** Live WebContents of a tab (the active one when omitted); null if unknown or destroyed. */
  contentsOf(tabId?: string): WebContents | null {
    const tab = tabId ? this.tabs.find((candidate) => candidate.id === tabId) ?? null : this.active
    if (tab instanceof ImageTab) throw new Error('This is an image viewer tab. Use a web tab for browser page tools.')
    if (tab instanceof FileTab) throw new Error('This is a file viewer tab. Use a web tab for browser page tools.')
    if (tab instanceof VideoTab) throw new Error('This is a video viewer tab. Use a web tab for browser page tools.')
    if (tab instanceof VideoHubTab) throw new Error('This is the video library tab. Use a web tab for browser page tools.')
    if (tab) this.prepareTabForTool(tab)
    // Every page tool reaches its page through here; the beat afterwards makes a burst one exemption.
    if (tab instanceof BrowserTab) this.cadence.touch(tab.id)
    const contents = tab?.view.webContents
    return contents && !contents.isDestroyed() ? contents : null
  }

  /**
   * Bring a tab to the front so it can receive real input, reporting whether that switched tabs.
   * Null means no tab can: the pane is gone or the page is covered by app chrome.
   *
   * A background tab keeps honest bounds (so CDP geometry still reads correctly) but is
   * setVisible(false). Chromium routes trusted input through the compositor, so an invisible
   * view silently drops clicks and keystrokes and never acks a wheel event. Foregrounding the
   * tab is the only way to deliver one.
   */
  focusTabForInput(tabId: string): { activated: boolean } | null {
    const tab = this.tabs.find((candidate) => candidate.id === tabId)
    if (!(tab instanceof BrowserTab)) return null
    if (!browserSurfaceVisibility(this.bounds).pageVisible) return null
    if (this.activeId === tabId) return { activated: false }
    this.setActive(tabId)
    return { activated: true }
  }

  /**
   * Keep a tab's compositor attached while a frame-dependent tool operates on it. The view never
   * leaves this window: a covered or collapsed pane parks it with one pixel still inside, where
   * Chromium keeps it mapped, laid out at the pane's size and capturable.
   */
  leaseTabRendering(tabId: string): (() => void) | null {
    const tab = this.tabs.find((candidate) => candidate.id === tabId)
    if (!(tab instanceof BrowserTab)) return null
    const release = this.rendering.pin(tabId)
    try { this.prepareTabForTool(tab) } catch (error) { release(); throw error }
    return () => {
      release()
      if (this.tabs.includes(tab)) this.prepareTabForTool(tab)
    }
  }

  private prepareTabForTool(tab: BrowserTab): void {
    prepareBrowserTabForTool({
      tab, active: this.active, activeId: this.activeId, bounds: this.bounds,
      rendering: this.rendering, attachTabView: (tabId) => { this.attachTabView(tabId) }
    })
  }

  /** Navigate a targeted tab, the active tab by default, or a new active tab. */
  async navigateTab(input: string, newTab: boolean, tabId?: string): Promise<string> {
    if (newTab && tabId) throw new Error('tab_id cannot be used with new_tab')
    let tab: BrowserTab
    if (newTab) {
      tab = this.createTab(true)
    } else if (tabId) {
      const targeted = this.tabs.find((candidate) => candidate.id === tabId)
      if (!targeted) throw new Error(describeMissingTab(tabId, this.tabList()))
      if (targeted instanceof ImageTab) throw new Error('Open a new web tab to navigate from an image viewer.')
      if (targeted instanceof FileTab) throw new Error('Open a new web tab to navigate from a file viewer.')
      if (targeted instanceof VideoTab) throw new Error('Open a new web tab to navigate from a video viewer.')
      if (targeted instanceof VideoHubTab) throw new Error('Open a new web tab to navigate from the video library.')
      tab = targeted
    } else {
      tab = this.requireActive()
    }
    // Navigating a tab brings it to the front, like opening one does: the user sees the page the
    // model is driving, and a selected tab is the one Chromium runs at full speed.
    if (tab.id !== this.activeId) this.setActive(tab.id)
    // Hold full cadence across the load: a throttled page reaches dom-ready and then stalls on
    // its own deferred work, which is exactly what the caller is waiting for.
    const release = this.cadence.hold(tab.id)
    try { await tab.navigate(input) } finally { release() }
    return tab.id
  }

  back(tabId?: string): void {
    const tab = tabId ? this.tabs.find(tab => tab.id === tabId) : this.requireActive()
    if (tab instanceof BrowserTab) tab.back()
  }

  forward(tabId?: string): void {
    const tab = tabId ? this.tabs.find(tab => tab.id === tabId) : this.requireActive()
    if (tab instanceof BrowserTab) tab.forward()
  }

  reload(): void {
    this.requireActive().reload()
  }

  snapshot(): BrowserState {
    const base = this.active?.getState() ??
      { url: 'about:blank', title: 'New Tab', isLoading: false, canGoBack: false, canGoForward: false }
    return this.enrichState(base)
  }

  // Full state for renderer mount: constructor emits precede IPC and reloads have no history,
  // so the UI pulls once instead of waiting for another navigation.
  browserSnapshot(): { state: BrowserState; tabs: BrowserTabInfo[] } {
    return { state: this.snapshot(), tabs: this.tabInfos() }
  }

  // A still of the active tab for the renderer's overlay freeze (the native view composites
  // above the DOM, so a shelf, dialog or layout drag shows this image while the live pixels are
  // parked). One capture runs at a time; a caller arriving mid-capture shares its result and the
  // renderer re-requests once the latest size is known.
  async capture(): Promise<BrowserShot | null> {
    if (this.overlayCapture) return this.overlayCapture
    const tab = this.active
    if (!(tab instanceof BrowserTab)) return null
    // The parked page keeps painting at its current bounds, so a double rAF is a real frame at
    // the size the still stands in for, not a timeout.
    const release = this.rendering.pin(tab.id)
    const pending = settleFrames(tab.view.webContents, CAPTURE_SETTLE_MS)
      .then(() => tab.screenshot())
      .then((imageUrl): BrowserShot | null => {
        if (!imageUrl || this.active !== tab) return null
        const state = tab.getState()
        return { imageUrl, tabId: tab.id, url: state.url, title: state.title }
      })
      .catch(() => null)
      .finally(() => {
        try { release() } finally { this.overlayCapture = null }
      })
    this.overlayCapture = pending
    return pending
  }

  searchHistory(input: string) {
    return this.history.search?.(input) ?? []
  }

  removeHistory(url: string): void {
    this.history.remove?.(url)
  }

  // Best omnibox inline-completion for the current input, or null if none.
  suggest(input: string): { completion: string; url: string } | null {
    return this.history.suggest(input)
  }

  dispose(): void {
    this.disposed = true
    this.persistentSessionCookies.dispose()
    this.rendering.dispose()
    this.cadence.dispose()
    for (const tab of this.tabs) {
      try {
        if (tab instanceof BrowserTab) this.window.contentView.removeChildView(tab.view)
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
    if (!(tab instanceof BrowserTab)) throw new Error('Open or select a web tab to use browser navigation.')
    return tab
  }

  private tabOpsHost(): BrowserServiceTabOpsHost {
    return {
      window: this.window,
      tabs: this.tabs,
      getActiveId: () => this.activeId,
      setActiveId: (id) => { this.activeId = id },
      bounds: this.bounds,
      rendering: this.rendering,
      cadence: this.cadence,
      openHomeTab: () => { this.openTab(HOME_URL, true) },
      attachTabView: (tabId) => { this.attachTabView(tabId) },
      emitTabState: (state) => { this.emit('state', this.enrichState(state)) },
      emitTabs: () => { this.emitTabs() },
      unregisterRendering: (id) => { this.rendering.unregister(id) },
      forgetCadence: (id) => { this.cadence.forget(id) },
      detachBrowserView: (tab) => { this.detachTabView(tab.id) },
      sanitizeVideoCompare: (closedId) => { this.sanitizeVideoCompare(closedId) }
    }
  }

  private configureSession(partitionSession: Electron.Session): void {
    // Normalize wire identity (strip the embedder tokens from the UA, Google auth client hints)
    // and install the session-level network observer and rules on the same header pipeline.
    this.observers.install(partitionSession, app.getName())
    installPermissionPolicy(partitionSession, {
      ...this.permissions,
      tabIdFor: (contents) => this.tabIdForContents(contents.id),
      captureSources: () => desktopCapturer.getSources({ types: ['screen', 'window'] })
    })
    // Persistent V8 code cache, as Chrome keeps for every profile.
    partitionSession.setCodeCachePath(join(app.getPath('userData'), 'code-cache'))
  }
}
