import { layoutGroups } from '../chat-layout/layout-docking.js'
import { isViewTabId, paneIds, type ChatLayout } from '../chat-layout/layout-tree.js'
import { addTab, moveTab, selectTab, tabIds, tabOwner } from '../chat-layout/layout-tabs.js'
import { floatWindow, mapWindow } from '../chat-layout/floating/window-layout.js'
import { viewKindOf, viewTabId } from '../chat-layout/layout-views.js'

// A notepad window is an ordinary tile whose tabs are notes (`closedai:view:note:<noteId>`), so it
// floats, snaps, minimizes and restores like any window. Its one chat lives on the tile itself
// (`notepadChat`), not in a tab: switching notes keeps the conversation, and moving a note to
// another window leaves the chat behind.

/** Where a new notepad window opens when there is none to join. */
const NEW_WINDOW = { x: 96, y: 64, width: 760, height: 560 }

export function noteTabId(noteId: string): string {
  return viewTabId('note', noteId)
}

export function noteIdOfTab(tabId: string): string | null {
  return viewKindOf(tabId) === 'note' ? tabId.slice(viewTabId('note', '').length) || null : null
}

export function isNoteTab(tabId: string): boolean {
  return noteIdOfTab(tabId) !== null
}

type PaneNode = Extract<ChatLayout, { kind: 'pane' }>

function panes(tree: ChatLayout | null): PaneNode[] {
  if (!tree) return []
  return tree.kind === 'pane' ? [tree] : [...panes(tree.first), ...panes(tree.second)]
}

/** Every notepad window's chat, so main keeps them attached like the browser's quick chat. */
export function notepadChats(tree: ChatLayout | null): string[] {
  return panes(tree).flatMap((pane) => pane.notepadChat ? [pane.notepadChat] : [])
}

/** The chat of the window that holds `tabId`. */
export function tileNotepadChat(tree: ChatLayout | null, tabId: string): string | null {
  const owner = tabOwner(tree, tabId)
  return panes(tree).find((pane) => pane.id === owner)?.notepadChat ?? null
}

/** Note ids in the window that holds `tabId`, in strip order. */
export function tileNoteIds(tree: ChatLayout | null, tabId: string): string[] {
  const owner = tabOwner(tree, tabId)
  return tabIds(tree).filter((id) => tabOwner(tree, id) === owner).flatMap((id) => {
    const noteId = noteIdOfTab(id)
    return noteId ? [noteId] : []
  })
}

export function withNotepadChat(tree: ChatLayout, tabId: string, chatId: string | null): ChatLayout {
  const owner = tabOwner(tree, tabId)
  if (!owner) return tree
  return mapWindow(tree, owner, (pane) => {
    const { notepadChat: _previous, ...rest } = pane
    return chatId ? { ...rest, notepadChat: chatId } : rest
  })
}

/** A window whose front tab is a note, preferring the one `near` belongs to. */
function notepadTile(tree: ChatLayout, near: string | null): string | null {
  const owner = near ? tabOwner(tree, near) : null
  if (owner && isNoteTab(owner)) return owner
  return layoutGroups(tree).find((group) => !group.docked && isNoteTab(group.id))?.id
    ?? layoutGroups(tree).find((group) => isNoteTab(group.id))?.id ?? null
}

/**
 * Show a note: its tab where it already is, else a new tab in a notepad window (the one `near`
 * is in, or any), else a new floating notepad window of its own.
 */
export function openNoteInTree(tree: ChatLayout, noteId: string, near: string | null, splitId: string, newWindow = false): ChatLayout {
  const tab = noteTabId(noteId)
  const holder = tabOwner(tree, tab)
  if (holder) return selectTab(tree, holder, tab)
  const tile = newWindow ? null : notepadTile(tree, near)
  if (tile) return addTab(tree, tile, tab)
  const host = paneIds(tree).find((id) => !isViewTabId(id)) ?? paneIds(tree)[0]
  if (!host) return tree
  // Tear the new tab straight off the host tile, the way a dragged-out tab becomes a window, and
  // give the host back the tab it had in front.
  const joined = addTab(tree, host, tab)
  const split = moveTab(joined, tab, tab, 'right', splitId)
  return split === joined ? joined : floatWindow(selectTab(split, host, host), tab, NEW_WINDOW)
}
