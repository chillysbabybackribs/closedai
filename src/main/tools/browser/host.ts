import type { PageReadiness, PageReadyResult, PageText } from '../../browser-page-ready.js'
import type { BrowserTabInfo } from '../../../shared/types.js'

export type NavigateOutcome =
  | { ok: true; tabId: string; ready: PageReadyResult }
  | { ok: false; error: string }

/**
 * What the browser tool needs from the embedded browser. browser-page-access.ts implements
 * it over BrowserService; tests pass a fake. Tools depend on this, never on BrowserService.
 */
export type BrowserToolHost = {
  listTabs(): BrowserTabInfo[]
  /** Active tab when `tabId` is omitted. Null when the tab does not exist or has no page. */
  readPage(tabId: string | undefined, options: { selector?: string; maxChars: number }): Promise<PageText | null>
  navigate(url: string, options: { newTab: boolean; ready: PageReadiness }): Promise<NavigateOutcome>
  /** Null when the tab does not exist. */
  waitFor(tabId: string | undefined, ready: PageReadiness): Promise<PageReadyResult | null>
}

/** Resolved lazily: the browser is created after the chat service. */
export type BrowserHostProvider = () => BrowserToolHost | null

export function requireBrowser(provider: BrowserHostProvider): BrowserToolHost {
  const host = provider()
  if (!host) throw new Error('The browser is not available yet')
  return host
}
