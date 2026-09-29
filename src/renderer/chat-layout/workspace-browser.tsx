import { useEffect, type ReactElement, type ReactNode } from 'react'
import { BrowserPane } from '../browser-pane.js'
import type { BrowserSavedSitesController } from '../browser-saved-sites-controller.js'
import { useBrowserController } from '../browser-controller.js'

/**
 * The shared browser, mounted only in the main window: its native page is laid out there, and a
 * detached window's renderer must never report bounds for it.
 */
export function WorkspaceBrowser({ layoutKey, visible, occluded, savedSites, dragHandle, windowControls, quickChat, onReveal, onShow }: {
  layoutKey: string
  visible: boolean
  occluded: boolean
  savedSites: BrowserSavedSitesController
  dragHandle: ReactNode
  windowControls: ReactNode
  quickChat: ReactNode
  /** An image or local file opened in the browser brings it forward with a reveal. */
  onReveal: () => void
  /** A tab showing an image keeps the browser shown. */
  onShow: () => void
}): ReactElement {
  const browser = useBrowserController(layoutKey, visible, occluded)
  const imageTabId = browser.browser.image?.tabId
  useEffect(() => window.closedai.browser.onState((state) => {
    if (state.image || state.url.startsWith('file:')) onReveal()
  }), [onReveal])
  useEffect(() => {
    if (imageTabId) onShow()
  }, [imageTabId, onShow])
  return <div className="workspace-right" data-mode="browser" data-with-browser={visible ? 'yes' : 'no'}>
    <div className={`workspace-surface workspace-surface-browser${visible ? '' : ' is-collapsed'}`}>
      <BrowserPane controller={browser} savedSites={savedSites} dragHandle={dragHandle} windowControls={windowControls} quickChat={quickChat} />
    </div>
  </div>
}
