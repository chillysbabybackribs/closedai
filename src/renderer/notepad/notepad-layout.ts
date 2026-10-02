import { type ChatLayout } from '../chat-layout/layout-tree.js'
import { tabIds, tabOwner } from '../chat-layout/layout-tabs.js'
import { mapWindow } from '../chat-layout/floating/window-layout.js'
import { openTabInTree, viewKindOf, viewTabId } from '../chat-layout/layout-views.js'

// A notepad window is an ordinary tile whose tabs are notes (`closedai:view:note:<noteId>`), so it
// floats, snaps, minimizes and restores like any window. Its one chat lives on the tile itself
// (`notepadChat`), not in a tab: switching notes keeps the conversation, and moving a note to
// another window leaves the chat behind.

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

/** Drop the chat of any window whose chat main no longer has (archived, deleted). */
export function pruneNotepadChats(tree: ChatLayout | null, available: Set<string>): ChatLayout | null {
  if (!tree) return tree
  if (tree.kind === 'pane') {
    if (!tree.notepadChat || available.has(tree.notepadChat)) return tree
    const { notepadChat: _gone, ...rest } = tree
    return rest
  }
  const first = pruneNotepadChats(tree.first, available)!
  const second = pruneNotepadChats(tree.second, available)!
  return first === tree.first && second === tree.second ? tree : { ...tree, first, second }
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

/** A model's new note joins its chat's window behind the tab the user is on. */
export function addNoteToChatWindow(tree: ChatLayout, chatId: string, noteId: string): ChatLayout {
  const tab = noteTabId(noteId)
  if (tabOwner(tree, tab)) return tree
  const pane = panes(tree).find((node) => node.notepadChat === chatId)
  if (!pane) return tree
  return mapWindow(tree, pane.id, (node) => ({ ...node, tabs: [...(node.tabs ?? [node.id]), tab] }))
}

/** Show a note: its tab, a notepad window's new tab, or a notepad window of its own ({@link openTabInTree}). */
export function openNoteInTree(tree: ChatLayout, noteId: string, near: string | null, splitId: string, newWindow = false,
  place?: (tree: ChatLayout, id: string) => ChatLayout | null): ChatLayout {
  return openTabInTree(tree, noteTabId(noteId), near, splitId, newWindow, place)
}
