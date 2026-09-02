import type { JSX } from 'react'
import { Bot, ChevronDown, LoaderCircle, X } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { ChatPeerSummary } from '../../shared/chat-peers.js'

const VISIBLE_LIMIT = 2

export type PeerChatCardsProps = {
  peers: ChatPeerSummary[]
  onSelect: (paneId: string) => void
  onClose?: (paneId: string) => void
}

/**
 * Floating agent shelf rendered above the composer.
 * Displays primary background peers as interactive pills (showing live status and task title)
 * with a quick retire-to-history button, and clusters additional peers in a "+N more" flyout.
 */
export function PeerChatCards({
  peers,
  onSelect,
  onClose
}: PeerChatCardsProps): JSX.Element | null {
  if (peers.length === 0) return null

  // Prioritize actively running peers, then sort by latest update time.
  const sorted = [...peers].sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1
    return b.updatedAt - a.updatedAt
  })

  const visible = sorted.slice(0, VISIBLE_LIMIT)
  const overflow = sorted.slice(VISIBLE_LIMIT)

  return (
    <nav className="peer-chat-shelf" aria-label="Peer chats">
      <div className="peer-chat-shelf-inner">
        {visible.map((peer) => {
          const tooltip = peer.activity ? `${peer.title} — ${peer.activity}` : peer.title
          return (
            <div key={peer.paneId} className="peer-chat-pill" title={tooltip}>
              <button
                type="button"
                className="peer-chat-pill-main"
                onClick={() => onSelect(peer.paneId)}
                aria-label={`Switch to ${peer.title}`}
              >
                {peer.running ? (
                  <LoaderCircle className="peer-chat-pill-icon peer-chat-pill-running" aria-label="Running" />
                ) : (
                  <Bot className="peer-chat-pill-icon peer-chat-pill-idle" aria-hidden="true" />
                )}
                <span className="peer-chat-pill-title">{peer.title}</span>
              </button>
              {onClose && (
                <button
                  type="button"
                  className="peer-chat-pill-close"
                  onClick={() => onClose(peer.paneId)}
                  aria-label={`Retire ${peer.title} to history`}
                  title="Retire to history"
                >
                  <X className="peer-chat-pill-close-icon" aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}

        {overflow.length > 0 && (
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger
              className="peer-chat-pill peer-chat-overflow-trigger"
              aria-label={`${overflow.length} more peer chats`}
            >
              <span>{`+${overflow.length} more`}</span>
              <ChevronDown className="peer-chat-overflow-caret" aria-hidden="true" />
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="peer-chat-menu"
                align="start"
                side="top"
                sideOffset={8}
                collisionPadding={12}
              >
                <DropdownMenu.Label className="peer-chat-menu-label">
                  Background Peers ({overflow.length})
                </DropdownMenu.Label>
                {overflow.map((peer) => {
                  const tooltip = peer.activity ? `${peer.title} — ${peer.activity}` : peer.title
                  return (
                    <div
                      key={peer.paneId}
                      className="peer-chat-menu-item"
                      title={tooltip}
                    >
                      <button
                        type="button"
                        className="peer-chat-menu-item-main"
                        onClick={() => onSelect(peer.paneId)}
                      >
                        {peer.running ? (
                          <LoaderCircle className="peer-chat-pill-icon peer-chat-pill-running" aria-label="Running" />
                        ) : (
                          <Bot className="peer-chat-pill-icon peer-chat-pill-idle" aria-hidden="true" />
                        )}
                        <span className="peer-chat-menu-item-text">
                          <span className="peer-chat-menu-item-title">{peer.title}</span>
                          {peer.activity && (
                            <span className="peer-chat-menu-item-activity">{peer.activity}</span>
                          )}
                        </span>
                      </button>
                      {onClose && (
                        <button
                          type="button"
                          className="peer-chat-menu-item-close"
                          onClick={() => onClose(peer.paneId)}
                          aria-label={`Retire ${peer.title} to history`}
                          title="Retire to history"
                        >
                          <X className="peer-chat-pill-close-icon" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
    </nav>
  )
}
