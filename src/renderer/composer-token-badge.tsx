import type { JSX } from 'react'

import type { ChatAttachment, ChatContextUsage } from '../shared/chat.js'
import { estimateDraftTokens, getDraftTokenStatus } from './composer-drafts.js'

export type ComposerTokenBadgeProps = {
  input: string
  attachments?: ChatAttachment[]
  contextUsage?: ChatContextUsage | null
}

export function ComposerTokenBadge({
  input,
  attachments = [],
  contextUsage = null
}: ComposerTokenBadgeProps): JSX.Element | null {
  const tokens = estimateDraftTokens(input, attachments)
  if (tokens <= 0) return null

  const status = getDraftTokenStatus(tokens, contextUsage?.contextWindow, contextUsage?.usedTokens)

  return (
    <div
      className={`composer-token-badge composer-token-badge-${status.level}`}
      title={status.tooltip}
      data-level={status.level}
      data-tokens={tokens}
      aria-label={status.tooltip}
    >
      {status.level !== 'normal' && (
        <span className="composer-token-badge-icon" aria-hidden="true">
          {status.level === 'critical' ? '⚠' : 'ℹ'}
        </span>
      )}
      <span className="composer-token-badge-text">{status.label}</span>
    </div>
  )
}
