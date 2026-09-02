import type { JSX } from 'react'
import { DropdownMenu } from 'radix-ui'
import { History, MessageSquareShare, MoreHorizontal, Plus, Wrench } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import type { ChatContextUsage } from '../shared/chat.js'

export type ChatHeaderProps = {
  title: string
  ready: boolean
  running: boolean
  historyOpen: boolean
  /** How full the model's window was after the latest response; null before the first one. */
  contextUsage: ChatContextUsage | null
  /** True once there is a conversation a fresh thread could carry on from. */
  canContinue: boolean
  onNewChat: () => void
  onContinueInNewChat: () => void
  onToggleHistory: () => void
  onOpenTools: () => void
}

/** Fixed row above the transcript: which chat this is, how full its context is, and thread actions. */
export function ChatHeader({
  title, ready, running, historyOpen, contextUsage, canContinue,
  onNewChat, onContinueInNewChat, onToggleHistory, onOpenTools
}: ChatHeaderProps): JSX.Element {
  return (
    <header className="chat-header">
      <span className="chat-header-title" title={title}>{title}</span>
      <span className="chat-header-spacer" />
      {contextUsage && <ContextGauge usage={contextUsage} />}
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
        <Plus className="size-4" aria-hidden="true" />
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
        <History className="size-4" aria-hidden="true" />
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="chat-header-action"
            aria-label="More options"
            title="More options"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="model-menu min-w-[12rem]" sideOffset={6} align="end">
            <DropdownMenu.Item
              className="model-menu-item flex items-center gap-2 pl-3"
              onSelect={onOpenTools}
            >
              <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>Tools</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="model-menu-item flex items-center gap-2 pl-3"
              disabled={!ready || running || !canContinue}
              onSelect={onContinueInNewChat}
            >
              <MessageSquareShare className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>Continue in new chat</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  )
}

/** Latency stays flat with context (prompt cache), so the colour tracks how much old history the
 * model is wading through; past these, quality drifts and a fresh chat is worth considering. */
const WARM_PERCENT = 50
const HOT_PERCENT = 75

function ContextGauge({ usage }: { usage: ChatContextUsage }): JSX.Element {
  const level = usage.percent >= HOT_PERCENT ? 'hot' : usage.percent >= WARM_PERCENT ? 'warm' : 'cool'
  const detail = `Context window ${usage.percent}% full: ${formatTokens(usage.usedTokens)} of ${formatTokens(usage.contextWindow)} tokens are replayed on every call`
  return (
    <span className="chat-header-context" data-level={level} title={detail} aria-label={detail}>
      {usage.percent}%
    </span>
  )
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k` : String(tokens)
}
