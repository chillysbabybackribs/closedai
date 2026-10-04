import { BROWSER_PANE_ID, DIVIDER_SIZE, isViewTabId, type ChatLayout, type Rect } from './layout-tree.js'

type Split = Extract<ChatLayout, { kind: 'split' }>
type Pane = Extract<ChatLayout, { kind: 'pane' }>
export type SidebarStack = Split & { first: Pane }
export type SidebarScrollArea = { id: string; rect: Rect; contentHeight: number; paneIds: string[] }
export const SIDE_CHAT_MIN_HEIGHT = 280

function chatLeaves(tree: ChatLayout): Pane[] | null {
  if (tree.kind === 'pane') return tree.id === BROWSER_PANE_ID || isViewTabId(tree.id) ? null : [tree]
  const first = chatLeaves(tree.first)
  const second = chatLeaves(tree.second)
  return first && second ? [...first, ...second] : null
}

export function isSidebarStack(tree: ChatLayout): tree is SidebarStack {
  return tree.kind === 'split' && tree.sidebarStack === true && tree.axis === 'horizontal'
    && tree.first.kind === 'pane' && chatLeaves(tree) !== null
}

export function findSidebarStack(tree: ChatLayout | null): SidebarStack | null {
  if (!tree || tree.kind === 'pane') return null
  return isSidebarStack(tree) ? tree : findSidebarStack(tree.first) ?? findSidebarStack(tree.second)
}

/** Upgrade the old tall-left/vertical-right arrangement once, retaining its exact divider. */
export function migrateSidebarStack(tree: ChatLayout): ChatLayout {
  if (tree.kind === 'pane' || isSidebarStack(tree)) return tree
  const vertical = (node: ChatLayout): boolean => node.kind === 'pane'
    ? !node.float && !node.docked : node.axis === 'vertical' && vertical(node.first) && vertical(node.second)
  if (tree.axis === 'horizontal' && tree.first.kind === 'pane' && !tree.first.float && !tree.first.docked
    && tree.second.kind === 'split' && vertical(tree.second) && chatLeaves(tree)) return { ...tree, sidebarStack: true }
  return { ...tree, first: migrateSidebarStack(tree.first), second: migrateSidebarStack(tree.second) }
}

/** Balanced storage avoids a depth limit as the scrollable side grows. */
export function sideChatTree(panes: readonly Pane[], newId: () => string): ChatLayout {
  if (panes.length === 1) return panes[0]!
  const middle = Math.ceil(panes.length / 2)
  return { kind: 'split', id: newId(), axis: 'vertical', ratio: middle / panes.length,
    first: sideChatTree(panes.slice(0, middle), newId), second: sideChatTree(panes.slice(middle), newId) }
}

export function appendSideChat(tree: ChatLayout, id: string, newId: () => string): ChatLayout | null {
  if (id === BROWSER_PANE_ID || isViewTabId(id)) return null
  const stack = findSidebarStack(tree)
  if (!stack) return null
  const panes = chatLeaves(stack)!
  if (panes.some((pane) => pane.id === id)) return tree
  const replace = (node: ChatLayout): ChatLayout => node === stack
    ? { ...stack, second: sideChatTree([...chatLeaves(stack.second)!, { kind: 'pane', id }], newId) }
    : node.kind === 'pane' ? node : { ...node, first: replace(node.first), second: replace(node.second) }
  return replace(tree)
}

/** Exchange just the two cards; preserve all other slots and the main divider. */
export function swapSidebarLead(tree: ChatLayout, id: string): ChatLayout | null {
  const stack = findSidebarStack(tree)
  const target = stack && chatLeaves(stack.second)!.find((pane) => pane.id === id && !pane.docked && !pane.float)
  if (!stack || !target || stack.first.docked || stack.first.float) return null
  const swap = (node: ChatLayout): ChatLayout => node === stack.first ? target : node === target ? stack.first
    : node.kind === 'pane' ? node : { ...node, first: swap(node.first), second: swap(node.second) }
  return swap(tree)
}

export function sidebarScrollArea(stack: SidebarStack, rect: Rect): SidebarScrollArea {
  const panes = chatLeaves(stack.second)!
  const rows = Math.min(panes.length, Math.max(1, Math.floor((rect.height + DIVIDER_SIZE) / (SIDE_CHAT_MIN_HEIGHT + DIVIDER_SIZE))))
  const height = Math.max(SIDE_CHAT_MIN_HEIGHT, (rect.height - (rows - 1) * DIVIDER_SIZE) / rows)
  return { id: stack.id, rect, contentHeight: panes.length * height + (panes.length - 1) * DIVIDER_SIZE,
    paneIds: panes.map((pane) => pane.id) }
}
