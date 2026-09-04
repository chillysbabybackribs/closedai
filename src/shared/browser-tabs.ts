import type { BrowserTabInfo } from './types.js'

// A tab id a model holds can go stale: the tab closed, or it came from before the app
// restarted with a strip that did not restore. The error that says so must let the model
// recover in the same pass, so it names the tabs that do exist.

/** Ids the app assigns; anything else in a persisted file is ignored. */
export const TAB_ID_PATTERN = /^tab-\d+$/

export function describeMissingTab(tabId: string | undefined, tabs: BrowserTabInfo[]): string {
  const open = tabs.length
    ? `Open tabs: ${tabs.map((tab) => `${tab.id}${tab.active ? ' (active)' : ''} ${labelOf(tab)}`).join(', ')}.`
    : 'No tabs are open.'
  if (!tabId) return `No active tab. ${open}`
  return `No tab with id ${tabId}. ${open} Pass one of these, or omit tab_id for the active tab.`
}

function labelOf(tab: BrowserTabInfo): string {
  const title = (tab.customTitle || tab.title || '').trim()
  const label = title || tab.url
  return `"${label.length > 40 ? label.slice(0, 39) + '…' : label}"`
}
