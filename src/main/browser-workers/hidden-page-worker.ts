import type { WebContents } from 'electron'
import { BrowserTab } from '../browser-tab.js'
import { EPHEMERAL_BROWSER_HISTORY } from '../browser-history-store.js'
import type { RenderedWorker } from './rendered-reader.js'

/** In-memory session shared by static source fetches and hidden workers; never the user's login. */
export const RESEARCH_PARTITION = 'research-public'

/**
 * A page worker is an ordinary BrowserTab that no window ever shows: same permission policy
 * and popup handling, but on the public research session, outside the tab strip, recording no
 * history. Page-requested windows are denied before any child is created.
 */
export function createHiddenPageWorker(): RenderedWorker {
  const tab = new BrowserTab(EPHEMERAL_BROWSER_HISTORY, () => {}, RESEARCH_PARTITION)
  const live = (): WebContents | null => {
    const contents = tab.view.webContents as WebContents | undefined
    return contents && !contents.isDestroyed() ? contents : null
  }
  // Hidden pages get Chromium's background timer throttling; a worker exists only to render, so
  // let its scripts run at full rate for the seconds it is leased.
  live()?.setBackgroundThrottling(false)
  return {
    id: tab.id,
    navigate: (url) => tab.navigate(url),
    dispose: () => tab.dispose(),
    alive: () => { const contents = live(); return Boolean(contents) && !contents!.isCrashed() },
    contents: () => live()
  }
}
