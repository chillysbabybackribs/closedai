import { isViewTabId, paneIds, type ChatLayout } from './layout-tree.js'
import { pruneTabs, selectTab, tabIds, tabOwner } from './layout-tabs.js'
import { isSingletonViewKind, oneKindPerTile, openTabInTree, viewKindOf, viewOfKind } from './layout-views.js'

// How a window's tab tree relates to the other app windows. A chat lives in one window: a window
// never restores, adopts or pulls forward a chat another window holds.

export type WindowTreeSeed = {
  /** Chats main lists; anything else in a saved tree was archived or removed. */
  available: Set<string>
  /** Chat tabs other windows hold. */
  elsewhere: Set<string>
  selectedPaneId: string
  /** A detached window shows only what was moved into it, never the workspace selection. */
  detached: boolean
  /** A detached window's tabs when it has no saved layout yet. */
  initialTabs: string[]
  /** A tab for a window left with none of its own chats. */
  fallbackView: () => string
}

/** The tree a window opens with: its saved layout, else the tabs it was opened with. */
export function initialWindowTree(saved: ChatLayout | null, seed: WindowTreeSeed): ChatLayout {
  const own = new Set([...seed.available].filter((id) => !seed.elsewhere.has(id)))
  let tree = pruneTabs(oneKindPerTile(saved), own)
  if (!tree || !paneIds(tree).length) {
    const tabs = seed.detached ? seed.initialTabs.filter((id) => isViewTabId(id) || own.has(id)) : []
    if (!seed.detached && own.has(seed.selectedPaneId)) tabs.push(seed.selectedPaneId)
    return tabs.length ? { kind: 'pane', id: tabs[0]!, tabs } : { kind: 'pane', id: seed.fallbackView() }
  }
  const selected = seed.selectedPaneId
  if (seed.detached || !own.has(selected)) return tree
  if (!tabIds(tree).includes(selected)) return openTabInTree(tree, selected, null, crypto.randomUUID())
  // Behind a sibling chat it surfaces.
  if (!paneIds(tree).includes(selected)) return selectTab(tree, tabOwner(tree, selected)!, selected)
  return tree
}

/**
 * Tabs handed back by a closing detached window join `anchor`'s window when it holds their kind,
 * else one that does, else a new window. A tab already here, or a singleton view kind this window
 * already shows, is skipped.
 */
export function adoptTabs(tree: ChatLayout, ids: string[], anchor: string | null): ChatLayout {
  if (!paneIds(tree).length) return tree
  let next = tree
  for (const id of ids) {
    if (tabIds(next).includes(id)) continue
    const kind = viewKindOf(id)
    if (isViewTabId(id) && (!kind || (isSingletonViewKind(kind) && viewOfKind(next, kind)))) continue
    next = openTabInTree(next, id, anchor, crypto.randomUUID())
  }
  return next
}
