import { useState, type JSX } from 'react'
import { ChevronDown, ChevronRight, MessageSquareShare } from 'lucide-react'

import type { ChatRowSummary } from '../shared/chat-peers.js'
import { handoffDigestForDisplay, handoffSourceTitle } from '../shared/chat-display.js'

export type ContinuationSource = NonNullable<ChatRowSummary['continuedFrom']>

/**
 * What an empty continued chat shows in place of a transcript: where it came from and exactly what
 * its first message will carry, so the hand-over is visible rather than a blank pane with a new
 * name. It disappears with the first message, when the digest is delivered and the transcript
 * takes over. The digest is model-facing text quoted as-is; nothing here summarizes it further.
 */
export function ContinuationCard({ source, canOpenSource, onOpenSource }: {
  source: ContinuationSource
  /** Whether the source chat still exists to open; a deleted or archived one leaves only the title. */
  canOpenSource: boolean
  onOpenSource: () => void
}): JSX.Element {
  const [showDigest, setShowDigest] = useState(false)
  const sourceLabel = handoffSourceTitle(source.title)
  return (
    <section className="chat-continuation-card" aria-labelledby="chat-continuation-heading">
      <header className="chat-continuation-header">
        <MessageSquareShare size={16} aria-hidden="true" />
        <h2 id="chat-continuation-heading">Continuing from “{sourceLabel}”</h2>
      </header>
      <p>
        Your first message here carries a digest of that conversation: what was asked, what was
        concluded, which files changed, and where it stood. Tool output, screenshots, and reasoning
        stay in the original chat, where the model can still look them up.
      </p>
      <div className="chat-continuation-actions">
        {canOpenSource && (
          <button type="button" className="chat-connection-link" data-ui="chat.continuation-source" onClick={onOpenSource}>
            Open previous chat
          </button>
        )}
        {source.handoff && (
          <button type="button" className="chat-connection-link chat-continuation-toggle" data-ui="chat.continuation-digest"
            aria-expanded={showDigest} aria-controls="chat-continuation-digest"
            onClick={() => setShowDigest((open) => !open)}>
            {showDigest ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            {showDigest ? 'Hide what the new chat receives' : 'Show what the new chat receives'}
          </button>
        )}
      </div>
      {showDigest && source.handoff && (
        <pre id="chat-continuation-digest" className="chat-continuation-digest" tabIndex={0}>{handoffDigestForDisplay(source.handoff)}</pre>
      )}
    </section>
  )
}
