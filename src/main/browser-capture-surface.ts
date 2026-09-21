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
      host.contentView.addChildView(tab.view)
      tab.applyBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height }, true)
    }
    entry.count++
    let released = false
    return () => {
      if (released) return
      released = true
      if (--entry.count > 0) return
      this.leases.delete(tab.id)
      if (!this.home.isDestroyed() && !tab.view.webContents.isDestroyed()) {
        tab.hide()
        this.home.contentView.addChildView(tab.view)
      }
      entry.host.destroy()
    }
  }

  dispose(): void {
    for (const entry of this.leases.values()) entry.host.destroy()
    this.leases.clear()
  }
}
