import { useCallback, useEffect, useMemo, useRef, type Dispatch } from 'react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { UNTITLED_NOTE } from '../../shared/notes.js'
import type { ChatWorkspaceAction } from '../chat-state.js'
import type { ChatLayout } from '../chat-layout/layout-tree.js'
import type { WindowOpen } from '../chat-layout/auto-place.js'
import { tabIds } from '../chat-layout/layout-tabs.js'
import { layoutGroups } from '../chat-layout/layout-docking.js'
import { readQuickChatModel, rememberQuickChatModel } from '../chat-layout/quick-chat-model.js'
import { tabsHeldElsewhere } from '../app-windows/app-window-store.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import type { NotepadHost } from './notepad-host.js'
import {
  addNoteToChatWindow, isNoteTab, noteIdOfTab, noteTabId, notepadChats, openNoteInTree, withNotepadChat
} from './notepad-layout.js'
import { noteMeta, onNoteChange } from './notes-client.js'

/** Notepad chats remember their own model, apart from the browser's quick chat. */
const MODEL_KEY = 'closedai.notepadChat.modelId'

type LayoutAccess = {
  tree: ChatLayout
  windows: { change: (change: (tree: ChatLayout) => ChatLayout) => void }
  openWindow: (change: WindowOpen) => void
  activateTab: (id: string, anchor?: string) => Promise<void>
  closeTab: (id: string) => Promise<void>
  newSideChat: (modelId: string | null, quickChatSurface?: import('../../shared/quick-chat-overlay.js').QuickChatSurface) => Promise<string>
}

/**
 * The workspace side of notepad windows: opening notes into them, giving each its chat, closing
 * the tabs of deleted notes, placing notes a model creates, and dropping empty notes whose tab
 * closed, so a stray New never leaves an Untitled note behind.
 */
export function useNotepadHost({ layout, chats, dispatch, appearance, onError }: {
  layout: LayoutAccess
  chats: ChatRowSummary[]
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  onError: (reason: unknown) => void
}): NotepadHost & { openNotepad: () => Promise<void> } {
  const access = useRef(layout)
  access.current = layout
  const openNote = useCallback((noteId: string, near: string | null) => {
    access.current.openWindow((tree, tile) => openNoteInTree(tree, noteId, near, crypto.randomUUID(), false, tile))
  }, [])
  const newNote = useCallback(async (near: string | null) => {
    const note = await window.closedai.notes.create('')
    openNote(note.id, near)
  }, [openNote])
  const setWindowChat = useCallback((tabId: string, chatId: string | null) => {
    access.current.windows.change((tree) => withNotepadChat(tree, tabId, chatId))
  }, [])
  const newChat = useCallback(() => access.current.newSideChat(readQuickChatModel(window.localStorage, MODEL_KEY), 'notepad'), [])
  const closeChat = useCallback(async (chatId: string) => { await window.closedai.chat.closePeer(chatId) }, [])

  // The model last picked in any notepad chat is the one the next notepad chat starts on.
  const padChats = notepadChats(layout.tree)
  const padModel = chats.filter((row) => padChats.includes(row.paneId)).map((row) => row.modelId).find(Boolean) ?? null
  useEffect(() => { if (padModel) rememberQuickChatModel(window.localStorage, padModel, MODEL_KEY) }, [padModel])

  useEffect(() => onNoteChange((change) => {
    const tab = noteTabId(change.note.id)
    if (change.text === null) {
      if (tabIds(access.current.tree).includes(tab)) void access.current.closeTab(tab)
      return
    }
    if (change.openInChat) {
      const chatId = change.openInChat
      access.current.windows.change((tree) => addNoteToChatWindow(tree, chatId, change.note.id))
    }
  }), [])

  // An empty note whose tab closed (and is open nowhere else) is removed rather than kept as clutter.
  const openNotes = tabIds(layout.tree).filter(isNoteTab)
  const openKey = openNotes.join('\0')
  const previous = useRef(openNotes)
  useEffect(() => {
    const now = new Set(openKey.split('\0').filter(Boolean))
    const held = tabsHeldElsewhere()
    for (const tab of previous.current) {
      if (now.has(tab) || held.has(tab)) continue
      const id = noteIdOfTab(tab)
      const meta = id ? noteMeta(id) : null
      if (!id || !meta || meta.named || meta.title !== UNTITLED_NOTE || meta.lineCount > 1) continue
      void window.closedai.notes.read(id).then((note) => {
        if (note && note.text.trim() === '') return window.closedai.notes.remove(id)
      }).catch(() => {})
    }
    previous.current = [...now]
  }, [openKey])

  /** The dock's Notes: the open notepad window in front, else the latest note, else a new one. */
  const openNotepad = useCallback(async () => {
    const tree = access.current.tree
    const window_ = layoutGroups(tree).find((group) => isNoteTab(group.id))
    if (window_) { await access.current.activateTab(window_.id); return }
    const latest = (await window.closedai.notes.list())[0]
    if (latest) openNote(latest.id, null)
    else await newNote(null)
  }, [newNote, openNote])

  return useMemo(() => ({
    tree: layout.tree, chats, dispatch, appearance, openNote, newNote, setWindowChat, newChat, closeChat, onError, openNotepad
  }), [layout.tree, chats, dispatch, appearance, openNote, newNote, setWindowChat, newChat, closeChat, onError, openNotepad])
}
