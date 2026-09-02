import type { JSX } from 'react'
import { useState } from 'react'
import { ChevronRight, LoaderCircle, MessageSquare } from 'lucide-react'
import type { ChatPeerSummary } from '../../shared/chat-peers.js'
import { PROVIDER_LABELS } from '../chat-state.js'

/** Bar fused to the composer top. The collapsed strip summarizes the background
 *  peers; hovering swaps it for one clickable row per peer, and moving the mouse
 *  away or clicking anywhere collapses it again. */
export function PeerChatCards({
  peers,
  onSelect,
  defaultOpen = false
}: {
  peers: ChatPeerSummary[]
  onSelect: (paneId: string) => void
  defaultOpen?: boolean
}): JSX.Element | null {
  const [open, setOpen] = useState(defaultOpen)
  if (peers.length === 0) return null
  const runningCount = peers.filter((peer) => peer.running).length
  return (
    <div
      className="peer-chat-bar"
      aria-label="Peer chats"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen(false)}
    >
      <div className="peer-chat-bar-inner">
        {open ? (
          <ul className="peer-chat-bar-list">
            {peers.map((peer) => (
              <li key={peer.paneId}>
                <button
                  className="peer-chat-bar-row"
                  type="button"
                  onClick={() => onSelect(peer.paneId)}
                  title={peer.preview || peer.title}
                >
                  {peer.running
                    ? <LoaderCircle className="peer-chat-bar-icon peer-chat-bar-running" aria-label="Running" />
                    : <MessageSquare className="peer-chat-bar-icon" aria-hidden="true" />}
                  <span className="peer-chat-bar-title">{peer.title}</span>
                  <span className="peer-chat-bar-meta">
                    {peer.activity || PROVIDER_LABELS[peer.provider]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <button
            className="peer-chat-bar-toggle"
            type="button"
            aria-expanded={false}
            onFocus={() => setOpen(true)}
          >
            <ChevronRight className="peer-chat-bar-chevron" aria-hidden="true" />
            <span>{peers.length === 1 ? '1 peer chat' : `${peers.length} peer chats`}</span>
            {runningCount > 0 && (
              <span className="peer-chat-bar-running-note">
                <LoaderCircle className="peer-chat-bar-icon peer-chat-bar-running" aria-label="Running" />
                {runningCount === 1 ? '1 running' : `${runningCount} running`}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
