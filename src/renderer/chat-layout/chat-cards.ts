import { linkFloatingPair } from './floating/floating-pair.js'
import { findWindow } from './floating/window-layout.js'
import { tabIds, tabOwner } from './layout-tabs.js'
import { isReservedPaneId, isViewTabId, type ChatLayout } from './layout-tree.js'

/** One conversation per window: a single chat tab and no sibling chat tabs in the tile. */
export function isChatCardPane(tree: ChatLayout, paneId: string): boolean {
  if (isReservedPaneId(paneId) || isViewTabId(paneId)) return false
  const chats = tabIds(tree).filter((tab) => tabOwner(tree, tab) === paneId && !isViewTabId(tab))
  return chats.length === 1
}

/** Swap a card's conversation while keeping float, dock, and browser pair geometry. */
export function replaceChatCardPane(tree: ChatLayout, paneId: string, chatId: string): ChatLayout {
  const visit = (node: ChatLayout): ChatLayout => {
    if (node.kind === 'split') return { ...node, first: visit(node.first), second: visit(node.second) }
    if (node.id !== paneId) return node
    return { ...node, id: chatId, tabs: [chatId] }
  }
  let next = visit(tree)
  if (findWindow(tree, paneId)?.floatPair === paneId) next = linkFloatingPair(next, chatId)
  return next
}

/** Keep every conversation visible in its own card, including legacy saved tab groups. */
export function separateChatCards(tree: ChatLayout): ChatLayout {
  if (tree.kind === 'split') {
    const first = separateChatCards(tree.first)
    const second = separateChatCards(tree.second)
    return first === tree.first && second === tree.second ? tree : { ...tree, first, second }
  }
  if (tree.kind === 'pane' && !isReservedPaneId(tree.id) && !isViewTabId(tree.id)) {
    const tabs = tree.tabs ?? [tree.id]
    const chatTabs = tabs.filter((id) => !isViewTabId(id))
    if (chatTabs.length === 1 && tree.id !== chatTabs[0]) return { ...tree, id: chatTabs[0], tabs: chatTabs }
  }
  if (isReservedPaneId(tree.id) || isViewTabId(tree.id) || (tree.tabs?.length ?? 0) < 2) return tree
  const ids = tree.tabs!.filter((id) => id !== tree.id)
  let next: ChatLayout = { ...tree, tabs: [tree.id] }
  for (const [index, id] of ids.entries()) {
    const offset = 28 * (index + 1)
    const rect = tree.float ?? { x: 32, y: 24, width: 560, height: 720, z: 0 }
    next = {
      kind: 'split', id: `chat-card-${id}`, axis: 'horizontal', ratio: 0.5,
      first: next,
      second: { ...tree, id, tabs: [id], float: { ...rect, x: rect.x + offset, y: rect.y + offset, z: rect.z + index + 1 } }
    }
  }
  return next
}
