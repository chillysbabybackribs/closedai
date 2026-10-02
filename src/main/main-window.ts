import { app, BrowserWindow, dialog, Menu, nativeImage, webContents, type NativeImage, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installAppContextMenu } from './app-context-menu.js'
import { installRendererRecovery } from './main-window-recovery.js'
import { APP_WINDOW_QUERY } from '../shared/app-windows.js'
export type MainWindowActions = {
  openLinkInNewTab: (url: string) => void
}

/**
 * Checkout `resources/icon.png`.
 * Prefer paths relative to the bundled main module and the checkout; `getAppPath()` alone
 * is not enough on every electron-vite preview layout.
 */
export function resolveAppIconPath(): string | null {
  const here = typeof import.meta.dirname === 'string'
    ? import.meta.dirname
    : dirname(fileURLToPath(import.meta.url))
  const candidates = [
    // out/main → ../../resources (checkout root beside out/)
    join(here, '..', '..', 'resources', 'icon.png'),
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(process.cwd(), 'resources', 'icon.png')
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

function loadAppIcon(): NativeImage | null {
  const iconPath = resolveAppIconPath()
  if (!iconPath) return null
  const icon = nativeImage.createFromPath(iconPath)
  return icon.isEmpty() ? null : icon
}

export function createMainWindow(actions: MainWindowActions): BrowserWindow {
  return createAppWindow(actions, { name: 'main', width: 1440, height: 920, minWidth: 1040, minHeight: 680 })
}

export type AppWindowFrame = {
  /** Electron persists bounds, display and maximized state per name across launches. */
  name: string
  width: number
  height: number
  minWidth: number
  minHeight: number
  /** Used only when no state was persisted under `name`. */
  x?: number
  y?: number
  /** False shows the window without taking focus from the one in front. */
  activate?: boolean
}

/** A frameless app-shell window; the renderer draws its own title bar and window controls. */
export function createAppWindow(actions: MainWindowActions, { activate = true, ...frame }: AppWindowFrame): BrowserWindow {
  const icon = loadAppIcon()
  const window = new BrowserWindow({
    ...frame,
    autoHideMenuBar: true,
    backgroundColor: '#0c0c0e',
    title: 'closedai',
    frame: false,
    show: false,
    windowStatePersistence: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return
    if (icon) window.setIcon(icon)
    if (activate) window.show()
    else window.showInactive()
  })

  installAppContextMenu(window.webContents, Menu, actions)
  installRendererRecovery(window, { showErrorBox: (title, content) => dialog.showErrorBox(title, content) })
  return window
}

/** Load the app shell; a detached window carries its id so its renderer knows which window it is. */
export function loadAppRenderer(window: BrowserWindow, windowId: string | null = null): void {
  loadRenderer(window, windowId ? { [APP_WINDOW_QUERY]: windowId } : undefined)
}

/** The built renderer a checkout or packaged launch loads; the dev server replaces it under `npm run dev`. */
export function builtRendererIndex(): string {
  return join(import.meta.dirname, '../renderer/index.html')
}

/** Reload every app surface (windows and layers) showing the built renderer; returns how many. */
export function reloadBuiltRenderers(): number {
  const entry = pathToFileURL(builtRendererIndex()).href
  const surfaces = webContents.getAllWebContents()
    .filter((contents) => !contents.isDestroyed() && contents.getURL().split(/[?#]/)[0] === entry)
  for (const contents of surfaces) contents.reload()
  return surfaces.length
}

function loadRenderer(target: Pick<WebContents, 'loadURL' | 'loadFile'>, query: Record<string, string> | undefined): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (query) url.search = new URLSearchParams(query).toString()
    void target.loadURL(url.toString())
  } else {
    void target.loadFile(builtRendererIndex(), query ? { query } : undefined)
  }
}
