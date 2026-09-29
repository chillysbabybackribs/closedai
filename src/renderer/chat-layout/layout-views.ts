import { VIEW_TAB_PREFIX, isViewTabId, type ChatLayout, type ViewScopes } from './layout-tree.js'
import { tabIds, tabOwner } from './layout-tabs.js'

// A view is a tab with a kind, not a chat and not a dialog: it shares the strip, drag, close and
// split with chats, and shows something about one chat (its scope) or about the workspace.

export const VIEW_KINDS = ['trace', 'agents', 'history', 'tools', 'saved-sites', 'note'] as const
export type ViewKind = typeof VIEW_KINDS[number]

/** Views that show workspace-wide content: one tab for the whole layout, opened or focused from anywhere. */
export const WORKSPACE_VIEW_KINDS = ['agents', 'saved-sites'] as const satisfies readonly ViewKind[]
export type WorkspaceViewKind = typeof WORKSPACE_VIEW_KINDS[number]

export function isWorkspaceViewKind(kind: ViewKind): kind is WorkspaceViewKind {
  return (WORKSPACE_VIEW_KINDS as readonly string[]).includes(kind)
}

export const VIEW_LABELS: Record<ViewKind, string> = {
  trace: 'Trace',
  agents: 'Agents',
  history: 'History',
  tools: 'Tools',
  'saved-sites': 'Saved sites',
  note: 'Note'
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

/** Chat tabs in the tile that owns `tileId`, in strip order. */
export function tileChats(tree: ChatLayout | null, tileId: string): string[] {
  return tabIds(tree).filter((id) => !isViewTabId(id) && tabOwner(tree, id) === tileId)
}

/** The existing view of this kind in a tile, so opening it again selects instead of duplicating. */
export function tileView(tree: ChatLayout | null, tileId: string, kind: ViewKind): string | null {
  return tabIds(tree).find((id) => viewKindOf(id) === kind && tabOwner(tree, id) === tileId) ?? null
}

/** The workspace's single tab of this kind, if any (see {@link WORKSPACE_VIEW_KINDS}). */
export function workspaceView(tree: ChatLayout | null, kind: WorkspaceViewKind): string | null {
  return tabIds(tree).find((id) => viewKindOf(id) === kind) ?? null
}

export function hasWorkspaceView(tree: ChatLayout | null, kind: WorkspaceViewKind): boolean {
  return workspaceView(tree, kind) !== null
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
