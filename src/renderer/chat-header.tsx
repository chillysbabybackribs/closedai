import type { JSX } from 'react'
import { History, SquarePen, Wrench } from 'lucide-react'

import { Button } from '../components/ui/button.js'

export type ChatHeaderProps = {
  title: string
  ready: boolean
  running: boolean
  historyOpen: boolean
  onNewChat: () => void
  onToggleHistory: () => void
  onOpenTools: () => void
}

/** Fixed row above the transcript: which chat this is, plus new chat, history, and tools. */
export function ChatHeader({ title, ready, running, historyOpen, onNewChat, onToggleHistory, onOpenTools }: ChatHeaderProps): JSX.Element {
  return (
    <header className="chat-header">
      <span className="chat-header-title" title={title}>{title}</span>
      <span className="chat-header-spacer" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="chat-header-action"
        aria-label="Tools"
        title="Tools"
        onClick={onOpenTools}
      >
        <Wrench aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="chat-header-action"
        aria-label="New chat"
        title="New chat"
        disabled={!ready || running}
        onClick={onNewChat}
      >
        <SquarePen aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="chat-header-action"
        aria-label={historyOpen ? 'Close chat history' : 'Chat history'}
        title="Chat history"
        aria-pressed={historyOpen}
        disabled={!ready && !historyOpen}
        onClick={onToggleHistory}
      >
        <History aria-hidden="true" />
      </Button>
    </header>
  )
}
