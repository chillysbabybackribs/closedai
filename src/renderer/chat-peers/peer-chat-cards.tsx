import type { JSX } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { ChatPeerSummary } from '../../shared/chat-peers.js'

/** Static strip fused to the composer top: one numbered, clickable item per
 *  background peer. The real chat title and activity live in the tooltip. */
export function PeerChatCards({
  peers,
  onSelect
}: {
  peers: ChatPeerSummary[]
  onSelect: (paneId: string) => void
}): JSX.Element | null {
  if (peers.length === 0) return null
  return (
    <nav className="peer-chat-bar" aria-label="Peer chats">
      <div className="peer-chat-bar-inner">
        {peers.map((peer, index) => (
          <button
            className="peer-chat-bar-item"
            key={peer.paneId}
            type="button"
            onClick={() => onSelect(peer.paneId)}
            title={peer.activity ? `${peer.title} — ${peer.activity}` : peer.title}
          >
            {peer.running && <LoaderCircle className="peer-chat-bar-icon peer-chat-bar-running" aria-label="Running" />}
            <span>{`Peer ${index + 1}`}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
