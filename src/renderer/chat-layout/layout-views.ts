import { appendSideChat } from './sidebar-stack.js'
import { layoutGroups } from './layout-docking.js'
import { VIEW_TAB_PREFIX, isViewTabId, paneIds, type ChatLayout, type ViewScopes } from './layout-tree.js'
import { addTab, removeTab, selectTab, tabIds, tabOwner } from './layout-tabs.js'
import { tabInNewWindow } from './floating/window-layout.js'

// A view is a tab with a kind, not a chat and not a dialog. A window's tabs are all one kind: chats
// only ever share a strip with chats, notes with notes, Trace with Trace. A view opens in a window
// of its own kind, else in a new window, and shows something about one chat (its scope) or about
// the workspace.

export const VIEW_KINDS = ['trace', 'history', 'tools', 'saved-sites', 'note', 'file'] as const
export type ViewKind = typeof VIEW_KINDS[number]

/** Notes and files are one tab per item; every other kind is one tab for the whole layout. */
export function isSingletonViewKind(kind: ViewKind): boolean {
  return kind !== 'note' && kind !== 'file'
}

export const VIEW_LABELS: Record<ViewKind, string> = {
  trace: 'Trace',
  history: 'History',
  tools: 'Tools',
  'saved-sites': 'Saved sites',
  note: 'Note',
  file: 'File'
}

export type ViewTab = { id: string; kind: ViewKind }

export function viewTabId(kind: ViewKind, key: string): string {
  return `${VIEW_TAB_PREFIX}${kind}:${key}`
}

export function parseViewTab(id: string): ViewTab | null {
  if (!isViewTabId(id)) return null
  const kind = id.slice(VIEW_TAB_PREFIX.length).split(':')[0]
  return (VIEW_KINDS as readonly string[]).includes(kind ?? '') ? { id, kind: kind as ViewKind } : null
}

export function viewKindOf(id: string): ViewKind | null {
  return parseViewTab(id)?.kind ?? null
}

/** 'chat', a view kind, or null for a view tab of a retired kind (Agents is a dialog now). */
export type TabKind = ViewKind | 'chat'
export function tabKind(id: string): TabKind | null {
  return isViewTabId(id) ? viewKindOf(id) : 'chat'
}

/** Whether `id` may join the strip of the window whose front tab is `tile`. */
export function sameTabKind(id: string, tile: string): boolean {
  return tabKind(id) !== null && tabKind(id) !== 'chat' && tabKind(id) === tabKind(tile)
}

/** The window `id` joins: `near`'s when it holds that kind, else any that does (shown before minimized). */
export function tileForTab(tree: ChatLayout, id: string, near?: string | null): string | null {
  const owner = near ? tabOwner(tree, near) : null
  if (owner && sameTabKind(id, owner)) return owner
  const groups = layoutGroups(tree).filter((group) => sameTabKind(id, group.id))
  return groups.find((group) => !group.docked)?.id ?? groups[0]?.id ?? null
}

/**
 * Show a tab: where it already is, else in a window of its kind (`near`'s, or any), else in a new
 * window: tiled by `place` (the layout's auto placement) when it finds room, else floating.
 */
export function openTabInTree(tree: ChatLayout, id: string, near: string | null, splitId: string, newWindow = false,
  place?: (tree: ChatLayout, id: string) => ChatLayout | null): ChatLayout {
  const holder = tabOwner(tree, id)
  if (holder) return selectTab(tree, holder, id)
  const side = appendSideChat(tree, id, () => crypto.randomUUID())
  if (side) return side
  const tile = newWindow ? null : tileForTab(tree, id, near)
  if (tile) return addTab(tree, tile, id)
  return place?.(tree, id) ?? tabInNewWindow(tree, id, near ?? undefined, splitId)
}

/**
 * Layouts saved before windows held one kind: a window with a chat keeps only its chats, any other
 * keeps the kind in front, and tabs of a retired kind go.
 */
export function oneKindPerTile(tree: ChatLayout | null): ChatLayout | null {
  let next = tree
  for (const tile of paneIds(tree)) {
    const tabs = tabIds(tree).filter((id) => tabOwner(tree, id) === tile)
    const kind = tabs.some((id) => tabKind(id) === 'chat') ? 'chat' : tabKind(tile) ?? tabs.map(tabKind).find(Boolean) ?? null
    for (const id of tabs) if (tabKind(id) === null || tabKind(id) !== kind) next = removeTab(next, id)
  }
  return next
}

/** Chat tabs in the tile that owns `tileId`, in strip order. */
export function tileChats(tree: ChatLayout | null, tileId: string): string[] {
  return tabIds(tree).filter((id) => !isViewTabId(id) && tabOwner(tree, id) === tileId)
}

/** The layout's tab of this kind, if any: opening a singleton kind again focuses it. */
export function viewOfKind(tree: ChatLayout | null, kind: ViewKind): string | null {
  return tabIds(tree).find((id) => viewKindOf(id) === kind) ?? null
}

export type ViewScope = { chatId: string; mode: 'pinned' | 'following' }

/**
 * The chat a view shows. Pinned wins. Otherwise the view follows its own tile: the selected chat
 * when it lives there, else the tile's first chat tab. A tile with no chat follows the workspace
 * selection, so a lone Trace tile always watches the chat being worked in.
 */
export function viewScope(tree: ChatLayout | null, viewId: string, scopes: ViewScopes | undefined, selectedChatId: string): ViewScope {
  const pinned = scopes?.[viewId]?.pinnedChatId
  if (pinned && tabIds(tree).includes(pinned)) return { chatId: pinned, mode: 'pinned' }
  const tile = tabOwner(tree, viewId)
  const chats = tile ? tileChats(tree, tile) : []
  const chatId = chats.includes(selectedChatId) ? selectedChatId : chats[0] ?? selectedChatId
  return { chatId, mode: 'following' }
}

/** Drop pins for views no longer in the tree or pointing at chats no longer open. */
export function pruneViewScopes(scopes: ViewScopes | undefined, tree: ChatLayout | null): ViewScopes | undefined {
  if (!scopes) return undefined
  const tabs = new Set(tabIds(tree))
  const entries = Object.entries(scopes).filter(([id, scope]) => tabs.has(id) && tabs.has(scope.pinnedChatId))
  if (entries.length === Object.keys(scopes).length) return scopes
  return entries.length ? Object.fromEntries(entries) : undefined
}

/**
 * A following view that leaves its tile would silently retarget, so the move pins it to the chat
 * it was showing. Same-tile moves and already pinned views are untouched.
 */
export function pinOnMove(tree: ChatLayout | null, viewId: string, destinationTile: string | null, scopes: ViewScopes | undefined, selectedChatId: string): ViewScopes | undefined {
  if (!isViewTabId(viewId) || scopes?.[viewId]) return scopes
  const source = tabOwner(tree, viewId)
  if (!source || (destinationTile !== null && destinationTile === source)) return scopes
  const { chatId } = viewScope(tree, viewId, scopes, selectedChatId)
  if (!tabIds(tree).includes(chatId)) return scopes
  return { ...scopes, [viewId]: { pinnedChatId: chatId } }
}
