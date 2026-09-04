import type { ResearchSnapshot } from '../../../shared/web-research.js'
import type { ToolContext } from '../tool.js'

export const SEARCH_PRESENTATION_FIELD = {
  type: 'string', enum: ['live', 'background'],
  description: 'Default live: open/reuse an actual source page as API results arrive. Never opens a search-engine results page. Until a source arrives, state is waiting_for_source. background opts out of browser presentation.'
}

export type OpenSearchTab = (url: string, context: ToolContext) => string

/** Search results and redirect wrappers are discovery surfaces, never research source pages. */
export function isResearchSourceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) return false
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/'
    if (/^(?:(?:www|encrypted|images|news|scholar)\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host)) {
      return !/^\/(?:$|search(?:\/|$)|webhp(?:\/|$)|url(?:\/|$)|imgres(?:\/|$)|aclk(?:\/|$)|sorry(?:\/|$))/.test(path)
    }
    if (/(^|\.)(?:bing\.com|duckduckgo\.com|search\.brave\.com|search\.yahoo\.com|yandex\.(?:com|ru))$/.test(host)) {
      return !/^\/(?:$|search(?:\/|$)|html(?:\/|$)|lite(?:\/|$))/.test(path)
    }
    return true
  } catch { return false }
}

/** Wait for a source, not for all providers. No query-to-browser fallback exists here. */
export class SourcePresentation {
  private value: ResearchSnapshot['presentation']

  constructor(private readonly open: OpenSearchTab | undefined, private readonly context: ToolContext, mode: unknown = 'live') {
    this.value = { state: mode === 'background' ? 'none' : 'waiting_for_source' }
  }

  consider(url: string): boolean {
    if (this.value.state !== 'waiting_for_source' || !isResearchSourceUrl(url)) return false
    this.value = presentSearch(this.open, url, this.context)
    return true
  }

  finish(): void {
    if (this.value.state === 'waiting_for_source') this.value = { state: 'no_source' }
  }

  snapshot(): ResearchSnapshot['presentation'] { return { ...this.value } }
}

export function presentSearch(
  open: OpenSearchTab | undefined,
  url: string,
  context: ToolContext,
  mode: unknown = 'live'
): ResearchSnapshot['presentation'] {
  if (mode === 'background') return { state: 'none' }
  try {
    if (!isResearchSourceUrl(url)) throw new Error('Research browser requires an actual source URL, never a search-engine results page')
    if (!open) throw new Error('Live browser is unavailable')
    context.signal.throwIfAborted()
    return { state: 'opened', tabId: open(url, context) }
  } catch (error) {
    return { state: 'failed', error: (error instanceof Error ? error.message : String(error)).slice(0, 300) }
  }
}

/** Reuse the research tab without navigating away from a page the user/model is inspecting. */
export class SearchBrowserTabs {
  private readonly tabs = new Map<string, string>()

  constructor(private readonly host: { exists(tabId: string): boolean; open(url: string): string }) {}

  open(url: string, context: ToolContext): string {
    if (!isResearchSourceUrl(url)) throw new Error('Search-engine pages cannot be opened for research source gathering')
    if (!context.paneId || !context.threadId || !context.turnId) throw new Error('Live search needs an active pane, thread, and turn')
    const key = JSON.stringify([context.paneId, context.threadId, context.turnId])
    const existing = this.tabs.get(key)
    if (existing && this.host.exists(existing)) return existing
    const tabId = this.host.open(url)
    this.tabs.delete(key)
    this.tabs.set(key, tabId)
    while (this.tabs.size > 64) this.tabs.delete(this.tabs.keys().next().value!)
    return tabId
  }
}
