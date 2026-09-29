import { createContext, type Dispatch } from 'react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatWorkspaceAction } from '../chat-state.js'
import type { ChatLayout } from '../chat-layout/layout-tree.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'

/** What a notepad window needs from the workspace around it: its tile, its chat, and layout moves. */
export type NotepadHost = {
  tree: ChatLayout
  chats: ChatRowSummary[]
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  /** Show a note: its tab, a tab in the notepad window near `near`, or a new notepad window. */
  openNote: (noteId: string, near: string | null) => void
  newNote: (near: string | null) => Promise<void>
  /** Give the window holding `tabId` its chat, or none. */
  setWindowChat: (tabId: string, chatId: string | null) => void
  /** A new chat outside the tiles, on the model notepad chats last used. */
  newChat: () => Promise<string>
  /** A chat the window no longer uses goes to History (or away, when blank). */
  closeChat: (chatId: string) => Promise<void>
  onError: (reason: unknown) => void
}

export const NotepadHostContext = createContext<NotepadHost | null>(null)
