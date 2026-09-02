import { app, BrowserWindow, Menu, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installAppContextMenu } from './app-context-menu.js'

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
  const icon = loadAppIcon()
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'closedai',
    frame: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Linux taskbars read `_NET_WM_ICON`. Frameless windows often leave that empty when the
  // constructor `icon` option is the only call — set it again once the window is mapped.
  if (icon) {
    window.setIcon(icon)
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.setIcon(icon)
    })
  }

  installAppContextMenu(window.webContents, Menu, actions)
  return window
}
