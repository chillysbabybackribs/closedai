import type { ResearchSnapshot } from '../../../shared/web-research.js'
import type { ToolContext } from '../tool.js'

export const SEARCH_PRESENTATION_FIELD = {
  type: 'string', enum: ['live', 'background'],
  description: 'Default live: open/reuse this turn’s research tab while API searches continue. Use background only when the user requests no browser. Returned presentation.tabId is the target for inspecting sources.'
}

export type OpenSearchTab = (url: string, context: ToolContext) => string

export function presentSearch(
  open: OpenSearchTab | undefined,
  url: string,
  context: ToolContext,
  mode: unknown = 'live'
): ResearchSnapshot['presentation'] {
  if (mode === 'background') return { state: 'none' }
  try {
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
