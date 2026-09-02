import type { JSX } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Folder, History, MessageSquareShare, MoreHorizontal, Plus, Wrench } from 'lucide-react'

import { Button } from '../components/ui/button.js'

export type ChatHeaderProps = {
  title: string
  /** Working folder of the thread; shown as the folder glyph's tooltip. */
  cwd: string
  ready: boolean
  running: boolean
  historyOpen: boolean
  /** True once there is a conversation a fresh thread could carry on from. */
  canContinue: boolean
  onNewChat: () => void
  onContinueInNewChat: () => void
  onToggleHistory: () => void
  onOpenTools: () => void
}

/** Fixed row above the transcript: which chat this is, in which folder, and one menu
 *  holding every thread action. Context load lives on the composer now, beside the
 *  model whose window it fills. */
export function ChatHeader({
  title, cwd, ready, running, historyOpen, canContinue,
  onNewChat, onContinueInNewChat, onToggleHistory, onOpenTools
}: ChatHeaderProps): JSX.Element {
  return (
    <header className="chat-header">
      <Folder className="chat-header-folder-icon size-3.5" aria-hidden="true" />
      <span className="chat-header-title" title={cwd ? `${title}\n${cwd}` : title}>{title}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="chat-header-action"
            aria-label="Chat actions"
            title="Chat actions"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="model-menu min-w-[13rem]" sideOffset={6} align="start">
            <DropdownMenu.Item
              className="model-menu-item flex items-center gap-2 pl-3"
              disabled={!ready || running}
              onSelect={onNewChat}
            >
              <Plus className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>New chat</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="model-menu-item flex items-center gap-2 pl-3"
              disabled={!ready && !historyOpen}
              onSelect={onToggleHistory}
            >
              <History className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{historyOpen ? 'Close chat history' : 'Chat history'}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="model-menu-item flex items-center gap-2 pl-3"
              disabled={!ready || running || !canContinue}
              onSelect={onContinueInNewChat}
            >
              <MessageSquareShare className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>Continue in new chat</span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="model-menu-separator" />
            <DropdownMenu.Item
              className="model-menu-item flex items-center gap-2 pl-3"
              onSelect={onOpenTools}
            >
              <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>Tools</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <span className="chat-header-spacer" />
    </header>
  )
}
