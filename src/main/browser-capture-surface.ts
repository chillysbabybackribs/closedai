import { BrowserWindow } from 'electron'
import type { BrowserTab } from './browser-tab.js'
import type { BrowserBounds } from '../shared/types.js'

/** Native capture host for a collapsed/covered browser, never mapped to the user's display. */
export class HiddenCaptureSurfaces {
  private readonly leases = new Map<string, { host: BrowserWindow; count: number }>()

  // Keep one native host alive: destroying a BrowserWindow during an HTML drag can
  // end Chromium's native drag routing, even when that window was never shown.
  private idleHost: BrowserWindow | null

  constructor(private readonly home: BrowserWindow) {
    this.idleHost = this.createHost(1, 1)
  }

  private createHost(width: number, height: number): BrowserWindow {
    return new BrowserWindow({ show: false, width, height,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  }

  has(id: string): boolean { return this.leases.has(id) }

  acquire(tab: BrowserTab, bounds: BrowserBounds): () => void {
    let entry = this.leases.get(tab.id)
    if (!entry) {
      const host = this.idleHost ?? this.createHost(bounds.width, bounds.height)
      this.idleHost = null
      host.setSize(Math.max(1, Math.round(bounds.width)), Math.max(1, Math.round(bounds.height)))
      entry = { host, count: 0 }
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
          // Keep the widget visible across reparenting. Hiding it here can leave its
          // frame sink blank after return, even though capturePage still sees pixels.
          tab.applyBounds({ ...bounds, occluded: true }, false)
          this.home.contentView.addChildView(tab.view)
          // A never-shown host leaves Chromium's widget hidden after reparenting,
          // independently of View visibility. Re-arm it while parked offscreen, then
          // preserve the cadence policy. Otherwise the window stays blank until a tab switch.
          const contents = tab.view.webContents
          const throttled = contents.getBackgroundThrottling()
          contents.setBackgroundThrottling(false)
          if (throttled) contents.setBackgroundThrottling(true)
        }
      } finally {
        if (!entry.host.isDestroyed()) {
          if (!this.idleHost) this.idleHost = entry.host
          else entry.host.destroy()
        }
      }
    }
  }

  dispose(): void {
    this.idleHost?.destroy()
    this.idleHost = null
    for (const entry of this.leases.values()) if (!entry.host.isDestroyed()) entry.host.destroy()
    this.leases.clear()
  }
}
