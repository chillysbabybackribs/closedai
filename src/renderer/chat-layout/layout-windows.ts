import { isViewTabId, paneIds, type ChatLayout } from './layout-tree.js'
import { addTab, pruneTabs, selectTab, tabIds, tabOwner } from './layout-tabs.js'
import { isWorkspaceViewKind, viewKindOf, workspaceView } from './layout-views.js'

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
  let tree = pruneTabs(saved, own)
  if (!tree || !paneIds(tree).length) {
    const tabs = seed.detached ? seed.initialTabs.filter((id) => isViewTabId(id) || own.has(id)) : []
    if (!seed.detached && own.has(seed.selectedPaneId)) tabs.push(seed.selectedPaneId)
    return tabs.length ? { kind: 'pane', id: tabs[0]!, tabs } : { kind: 'pane', id: seed.fallbackView() }
  }
  const selected = seed.selectedPaneId
  if (seed.detached || !own.has(selected)) return tree
  if (!tabIds(tree).includes(selected)) return selectTab(tree, paneIds(tree)[0]!, selected)
  // Behind a sibling chat it surfaces; behind a view it stays where the last session left it.
  if (!paneIds(tree).includes(selected) && !isViewTabId(tabOwner(tree, selected)!)) return selectTab(tree, paneIds(tree)[0]!, selected)
  return tree
}

/**
 * Tabs handed back by a closing detached window join `anchor`'s tile. A tab already here, or a
 * workspace-wide view kind this window already shows, is skipped.
 */
export function adoptTabs(tree: ChatLayout, ids: string[], anchor: string | null): ChatLayout {
  const tile = anchor && paneIds(tree).includes(anchor) ? anchor : paneIds(tree)[0]
  if (!tile) return tree
  let next = tree
  for (const id of ids) {
    if (tabIds(next).includes(id)) continue
    const kind = viewKindOf(id)
    if (kind && isWorkspaceViewKind(kind) && workspaceView(next, kind)) continue
    next = addTab(next, tabOwner(next, tile) ?? paneIds(next)[0]!, id)
  }
  return next
}
