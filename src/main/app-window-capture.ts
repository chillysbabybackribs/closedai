import { nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import { compositeBitmapBgra } from './app-window-composite-bitmap.js'
import type { BrowserBounds } from '../shared/types.js'
import type { BrowserService } from './browser-service.js'
import { browserSurfaceVisibility } from './browser-surface-visibility.js'

/** Paste `overlay` onto `base` at renderer-reported pane bounds (DIP → bitmap pixels). */
export function compositeOverlay(
  base: NativeImage,
  baseContentWidth: number,
  baseContentHeight: number,
  overlay: NativeImage,
  bounds: BrowserBounds
): NativeImage {
  const baseSize = base.getSize()
  const scaleX = baseContentWidth > 0 ? baseSize.width / baseContentWidth : 1
  const scaleY = baseContentHeight > 0 ? baseSize.height / baseContentHeight : 1
  const dest = {
    x: Math.round(bounds.x * scaleX),
    y: Math.round(bounds.y * scaleY),
    width: Math.max(1, Math.round(bounds.width * scaleX)),
    height: Math.max(1, Math.round(bounds.height * scaleY))
  }
  const bitmap = compositeBitmapBgra(base.toBitmap(), baseSize.width, baseSize.height, overlay, dest)
  return nativeImage.createFromBitmap(bitmap, { width: baseSize.width, height: baseSize.height })
}

/**
 * Full application window for models: renderer chrome via capturePage, plus the embedded web tab
 * composited where its surface sits (the pane, or the emulated or phone box). Avoids desktopCapturer / OS screencast portals on Linux.
 */
export async function captureComposedAppWindow(
  window: BrowserWindow,
  browser: BrowserService | null
): Promise<NativeImage | null> {
  const base = await window.webContents.capturePage()
  if (base.isEmpty()) return null
  if (!browser) return base

  const bounds = browser.paneBounds()
  const { pageVisible } = browserSurfaceVisibility(bounds)
  if (!pageVisible || bounds.width <= 1 || bounds.height <= 1) return base

  const overlay = await browser.activeWebTabNativeFrame()
  if (!overlay || overlay.isEmpty()) return base

  const [contentWidth, contentHeight] = window.getContentSize()
  return compositeOverlay(base, contentWidth, contentHeight, overlay, browser.activeWebTabSurfaceBounds())
}
