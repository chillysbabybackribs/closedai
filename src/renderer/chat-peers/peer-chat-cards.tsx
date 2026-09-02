import type { JSX } from 'react'
import { LoaderCircle, MessageSquare } from 'lucide-react'
import type { ChatPeerSummary } from '../../shared/chat-peers.js'
import { PROVIDER_LABELS } from '../chat-state.js'

export function PeerChatCards({
  peers,
  onSelect
}: {
  peers: ChatPeerSummary[]
  onSelect: (paneId: string) => void
}): JSX.Element | null {
  if (peers.length === 0) return null
  return (
    <nav className="peer-chat-cards" aria-label="Peer chats">
      {peers.map((peer) => (
        <button
          className="peer-chat-card"
          key={peer.paneId}
          type="button"
          onClick={() => onSelect(peer.paneId)}
          title={peer.preview || peer.title}
        >
          {peer.running
            ? <LoaderCircle className="peer-chat-card-icon peer-chat-card-running" aria-label="Running" />
            : <MessageSquare className="peer-chat-card-icon" aria-hidden="true" />}
          <span className="peer-chat-card-copy">
            <span className="peer-chat-card-title">{peer.title}</span>
            <span className="peer-chat-card-meta">
              {peer.activity || PROVIDER_LABELS[peer.provider]}
            </span>
          </span>
        </button>
      ))}
    </nav>
  )
}
