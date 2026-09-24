import type { BrowserBounds } from '../shared/types.js'
import { BrowserTab } from './browser-tab.js'
import { browserSurfaceVisibility } from './browser-surface-visibility.js'
import { prepareTabSurfaceForTool } from './browser-tab-activation.js'
import type { HiddenCaptureSurfaces } from './browser-capture-surface.js'
import type { TabRenderingPolicy } from './browser-tab-rendering.js'

export function prepareBrowserTabForTool(options: {
  tab: BrowserTab
  active: BrowserTab | import('./local-files/image-tab.js').ImageTab | import('./local-files/file-tab.js').FileTab | null
  activeId: string | null
  bounds: BrowserBounds
  rendering: TabRenderingPolicy
  captureSurfaces: HiddenCaptureSurfaces
  attachTabView: (tabId: string) => void
}): void {
  const { tab, active, activeId, bounds, rendering, captureSurfaces, attachTabView } = options
  if (captureSurfaces.has(tab.id)) return
  const visibility = browserSurfaceVisibility(bounds)
  if (rendering.describe(tab.id).pins > 0 && (tab.id !== activeId || !visibility.pageVisible)) {
    if (active instanceof BrowserTab && active.id !== tab.id && visibility.pageVisible) {
      tab.applyBounds(bounds, true)
      attachTabView(active.id)
    } else tab.applyBounds({ ...bounds, occluded: true }, false)
    return
  }
  prepareTabSurfaceForTool(tab, activeId, bounds, visibility)
  if (tab.id === activeId && visibility.pageVisible) captureSurfaces.restoreShown(tab)
  if (!visibility.paneVisible && tab.id !== activeId) tab.park(bounds)
}
