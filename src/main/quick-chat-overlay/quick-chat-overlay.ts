import { Menu, WebContentsView, type BaseWindow, type WebContents } from 'electron'
import { join } from 'node:path'
import {
  QUICK_CHAT_SURFACE, type QuickChatOverlaySize, type QuickChatOverlayState, type QuickChatOverlayView
} from '../../shared/quick-chat-overlay.js'
import { IPC } from '../../shared/ipc-channels.js'
import type { BrowserBounds } from '../../shared/types.js'
import { installAppContextMenu } from '../app-context-menu.js'
import { loadAppSurface } from '../main-window.js'
import type { AppSurfaceHandle, SurfaceContents } from '../windows/app-window-registry.js'
import { quickChatOverlayBounds } from './overlay-placement.js'

export type QuickChatOverlayHost = {
  window: BaseWindow
  /** Routes workspace events and the shown chat's stream to the layer. */
  attachSurface: (contents: SurfaceContents) => AppSurfaceHandle | null
  openLinkInNewTab: (url: string) => void
}

/**
 * The browser's quick chat layer: a transparent WebContentsView running the app renderer in its
 * quick chat mode, stacked above the page and sized to the card it draws. Nothing else can float
 * over the live page, which is itself a native view painting above the app shell.
 *
 * It is created the first time the page shows with the layout's state known, and from then on is
 * parked (not hidden or removed) whenever the page is covered or away, so it stays loaded and
 * keeps following its chat's stream.
 */
export class QuickChatOverlay {
  private view: WebContentsView | null = null
  private surface: AppSurfaceHandle | null = null
  private state: QuickChatOverlayState | null = null
  private page: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
  private pageVisible = false
  private size: QuickChatOverlaySize | null = null
  private disposed = false

  constructor(private readonly host: QuickChatOverlayHost) {}

  /** The main window's layout: which chat, and whether its card is open. */
  setState(state: QuickChatOverlayState): void {
    const paneId = typeof state?.paneId === 'string' && state.paneId ? state.paneId : null
    this.state = { paneId, open: Boolean(state?.open) && paneId !== null }
    this.surface?.show(paneId ? [paneId] : [])
    this.update(true)
  }

  /** The browser's page box and whether it is on screen, uncovered. */
  setPage(bounds: BrowserBounds, visible: boolean): void {
    const resized = bounds.width !== this.page.width || bounds.height !== this.page.height
    this.page = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    this.pageVisible = visible
    this.update(resized)
  }

  /** The layer's content box; only the layer itself may report it. */
  setSize(sender: Pick<WebContents, 'id'>, size: QuickChatOverlaySize): void {
    if (!this.owns(sender)) return
    this.size = size
    this.place()
  }

  owns(sender: Pick<WebContents, 'id'>): boolean {
    return this.view !== null && !this.view.webContents.isDestroyed() && this.view.webContents.id === sender.id
  }

  current(): QuickChatOverlayView | null {
    if (!this.state) return null
    return { ...this.state, page: { width: Math.round(this.page.width), height: Math.round(this.page.height) } }
  }

  /** Keep the layer above the page views; re-adding a child view only reorders it to the top. */
  raise(): void {
    if (this.view && !this.host.window.isDestroyed()) this.host.window.contentView.addChildView(this.view)
  }

  dispose(): void {
    this.disposed = true
    this.surface?.detach()
    this.surface = null
    const view = this.view
    this.view = null
    if (!view) return
    try {
      if (!this.host.window.isDestroyed()) this.host.window.contentView.removeChildView(view)
    } catch {
      // The window is already tearing its views down.
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  private update(publish: boolean): void {
    if (!this.view && this.state && this.pageVisible) this.create()
    if (publish) this.publish()
    this.place()
  }

  private create(): void {
    if (this.disposed || this.host.window.isDestroyed()) return
    const view = new WebContentsView({
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        transparent: true
      }
    })
    view.setBackgroundColor('#00000000')
    view.setBounds(quickChatOverlayBounds(this.page, null, false))
    this.view = view
    this.host.window.contentView.addChildView(view)
    const contents = view.webContents
    this.surface = this.host.attachSurface(contents)
    this.surface?.show(this.state?.paneId ? [this.state.paneId] : [])
    // The layer is the app's own page: it never navigates or opens windows of its own.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.on('render-process-gone', () => {
      if (!this.disposed && !contents.isDestroyed()) contents.reload()
    })
    installAppContextMenu(contents, Menu, { openLinkInNewTab: this.host.openLinkInNewTab })
    loadAppSurface(contents, QUICK_CHAT_SURFACE)
  }

  private publish(): void {
    const view = this.current()
    if (view && this.view && !this.view.webContents.isDestroyed()) this.view.webContents.send(IPC.event.quickChatView, view)
  }

  private place(): void {
    if (!this.view) return
    this.view.setBounds(quickChatOverlayBounds(this.page, this.size, this.pageVisible && this.state !== null))
  }
}
