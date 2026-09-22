import { session, type WebContents } from 'electron'
import type { BrowserHistory } from './browser-history-store.js'
import { BrowserError, isRendererGoneReason } from './browser-error.js'
import { selectFavicon } from './browser-favicon.js'
import { installTabZoom } from './browser-tab-zoom.js'
import { installContentsPermissionPolicy } from './browser-permissions.js'
import type { WebPermissionPolicy } from '../shared/security.js'
import { showBrowserContextMenu } from './browser-context-menu.js'
import { cookieImportTargetFor, refreshCookiesForUrl } from './cookie-refresh.js'
import { installPopupBridge } from './browser-popup-bridge.js'
import type { CreatePopupTab, PopupTabRequest } from './browser-popup-policy.js'
import type { BrowserNavigationFailureState } from './browser-navigation-failure-state.js'
import type { BrowserState } from '../shared/types.js'
import { PARTITION } from './browser-url.js'

type TabLiveness =
  | { alive: true }
  | { alive: false; category: 'target-closed' | 'target-crashed'; detail: string }

export type BrowserTabAttachHost = {
  tabId: string
  partition: string
  createPopupTab?: CreatePopupTab
  webContents: WebContents
  permissionPolicy: () => WebPermissionPolicy
  history: BrowserHistory
  liveness: () => TabLiveness
  setLiveness: (value: TabLiveness) => void
  state: () => BrowserState
  setState: (value: BrowserState) => void
  favicon: () => string | null
  setFavicon: (value: string | null) => void
  navigationFailures: BrowserNavigationFailureState
  onDidStartNavigation: (url: string, isInPlace: boolean, isMainFrame: boolean) => void
  onDidFailLoad: (errno: number, description: string, validatedUrl: string, isMainFrame: boolean) => void
  emitState: () => void
  refreshState: () => void
  refreshVisibleSurface: () => void
  adoptPageBackground: () => Promise<void>
  applyPageAppearance: () => void
  back: () => void
  forward: () => void
  reload: () => void
  navigate: (url: string) => Promise<void>
  openLinkInNewTab: (request: PopupTabRequest) => void
  emitError: (error: unknown) => void
  emitClosed: () => void
}

/** Wire WebContents listeners for one browser tab; the tab owns state and navigation methods. */
export function attachBrowserTabWebContentsEvents(host: BrowserTabAttachHost): void {
  const contents = host.webContents
  contents.on('render-process-gone', (_event, details) => {
    const reason = details?.reason ?? 'crashed'
    if (isRendererGoneReason(reason)) {
      host.setLiveness({ alive: false, category: 'target-crashed', detail: `renderer ${reason}` })
      host.emitError(new BrowserError('target-crashed', `Browser tab ${host.tabId}: renderer ${reason}`))
    }
  })
  contents.on('destroyed', () => {
    host.setLiveness({ alive: false, category: 'target-closed', detail: 'WebContents destroyed' })
    host.emitClosed()
  })
  contents.on('unresponsive', () => {
    host.emitError(new BrowserError('target-unresponsive', `Browser tab ${host.tabId}: renderer unresponsive`))
  })
  contents.on('will-prevent-unload', (event) => {
    event.preventDefault()
  })
  contents.on('did-start-loading', () => {
    host.setState({ ...host.state(), isLoading: true })
    host.emitState()
  })
  contents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    host.onDidStartNavigation(url, isInPlace, isMainFrame)
  })
  contents.on('did-stop-loading', () => {
    host.refreshState()
    host.emitState()
    host.refreshVisibleSurface()
  })
  contents.on('dom-ready', () => {
    void host.adoptPageBackground()
  })
  contents.on('did-finish-load', () => {
    host.applyPageAppearance()
    void host.adoptPageBackground()
  })
  installTabZoom(contents)
  installContentsPermissionPolicy(contents, host.permissionPolicy)
  contents.on('page-title-updated', () => {
    host.refreshState()
    host.history.updateTitle(host.state().url, host.state().title)
    host.emitState()
  })
  contents.on('page-favicon-updated', (_event, favicons) => {
    const next = selectFavicon(favicons)
    if (next) host.history.updateFavicon?.(contents.getURL(), next)
    if (next === host.favicon()) return
    host.setFavicon(next)
    host.emitState()
  })
  contents.on('did-navigate', () => {
    const liveness = host.liveness()
    if (!liveness.alive && liveness.category === 'target-crashed' && !contents.isDestroyed()) {
      host.setLiveness({ alive: true })
    }
    host.setState(host.navigationFailures.succeed(host.state()))
    host.refreshState()
    host.history.record(host.state().url, host.state().title)
    host.emitState()
  })
  contents.on('did-fail-load', (_event, errno, description, validatedUrl, isMainFrame) =>
    host.onDidFailLoad(errno, description, validatedUrl, isMainFrame))
  contents.on('did-navigate-in-page', () => {
    host.refreshState()
    host.emitState()
  })
  contents.on('context-menu', (_event, params) => {
    showBrowserContextMenu(contents, params, {
      back: () => host.back(),
      forward: () => host.forward(),
      reload: () => host.reload(),
      canGoBack: () => contents.navigationHistory.canGoBack(),
      canGoForward: () => contents.navigationHistory.canGoForward(),
      openUrl: (url) => { void host.navigate(url).catch((error: unknown) => host.emitError(error)) },
      openUrlInNewTab: (url) => host.openLinkInNewTab({ url, activate: false }),
      siteCookieImport: () => {
        const target = cookieImportTargetFor(contents.getURL())
        return target ? { domain: target.domain, source: target.source.name } : null
      },
      importSiteCookies: () => {
        void refreshCookiesForUrl(session.fromPartition(PARTITION), contents.getURL())
          .then(() => host.reload())
          .catch((error: unknown) => host.emitError(error))
      }
    })
  })
  installPopupBridge(contents, host.partition, host.createPopupTab)
}
