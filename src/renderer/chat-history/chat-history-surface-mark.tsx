import type { JSX } from 'react'
import type { QuickChatSurface } from '../../shared/quick-chat-overlay.js'
import { AppIconMark } from '../app-icons.js'

/** Spoken label for history rows and search results. */
export function chatHistorySurfaceLabel(surface: QuickChatSurface | null | undefined): string | null {
  if (surface === 'notepad') return 'Notepad chat'
  if (surface === 'browser') return 'Browser chat'
  return null
}

/** Notepad chats carry the note icon in history lists; tile chats leave the column empty. */
export function ChatHistorySurfaceMark({ surface, size, className }: {
  surface?: QuickChatSurface | null
  size: number
  className?: string
}): JSX.Element | null {
  if (surface !== 'notepad') return null
  return <AppIconMark id="note" size={size} className={className} />
}
