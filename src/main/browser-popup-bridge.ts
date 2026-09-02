import type { WebContents } from 'electron'
import {
  decideWindowOpen,
  isOAuthDestination,
  type PopupTabRequest
} from './browser-popup-policy.js'

export function installPopupBridge(
  contents: WebContents,
  partition: string,
  openTab: (request: PopupTabRequest) => void
): void {
  contents.setWindowOpenHandler((details) => {
    const decision = decideWindowOpen(details, partition)
    if (decision.kind === 'tab') openTab(decision.tab)
    return decision.response
  })
  contents.on('did-create-window', (window, details) => {
    window.setMenuBarVisibility(false)
    installPopupBridge(window.webContents, partition, openTab)
    if (details.options.show !== false) return
    // A featureless about:blank child has no useful routing signal until its first real
    // destination. Keep it invisible, then promote ordinary pages into CodeApp's tab strip;
    // OAuth retargets retain the real WindowProxy/opener context and become visible.
    window.webContents.on('will-navigate', (event, url, isInPlace, isMainFrame) => {
      if (isInPlace || !isMainFrame || url === 'about:blank') return
      if (isOAuthDestination(url)) {
        window.show()
        return
      }
      event.preventDefault()
      openTab({ url, activate: true })
      window.destroy()
    })
  })
}
