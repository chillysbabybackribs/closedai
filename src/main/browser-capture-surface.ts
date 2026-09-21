import { BrowserWindow } from 'electron'
import type { BrowserTab } from './browser-tab.js'
import type { BrowserBounds } from '../shared/types.js'

/** Native capture host for a collapsed/covered browser, never mapped to the user's display. */
export class HiddenCaptureSurfaces {
  private readonly leases = new Map<string, { host: BrowserWindow; count: number; tab: BrowserTab }>()

  constructor(private readonly home: BrowserWindow) {}

  has(id: string): boolean { return this.leases.has(id) }

  acquire(tab: BrowserTab, bounds: BrowserBounds): () => void {
    let entry = this.leases.get(tab.id)
    if (!entry) {
      const host = new BrowserWindow({ show: false, width: bounds.width, height: bounds.height,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      entry = { host, count: 0, tab }
      this.leases.set(tab.id, entry)
      try {
        // Initialize geometry before reparenting: attaching an offscreen/1px widget first
        // can leave Chromium without a usable frame sink even after its bounds change.
        tab.applyBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height }, true)
        host.contentView.addChildView(tab.view)
      } catch (error) {
        this.leases.delete(tab.id)
        host.destroy()
        throw error
      }
    }
    entry.count++
    let released = false
    return () => {
      if (released) return
      released = true
      if (--entry.count > 0) return
      this.leases.delete(tab.id)
      try {
        if (!this.home.isDestroyed() && !tab.view.webContents.isDestroyed()) {
          tab.hide()
          this.home.contentView.addChildView(tab.view)
        }
      } finally {
        if (!entry.host.isDestroyed()) entry.host.destroy()
      }
    }
  }

  dispose(): void {
    for (const entry of this.leases.values()) if (!entry.host.isDestroyed()) entry.host.destroy()
    this.leases.clear()
  }
}
