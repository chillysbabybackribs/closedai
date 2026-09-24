import type { JSX } from 'react'
import { useState } from 'react'
import { MessageSquareShare } from 'lucide-react'
import { errorMessage } from './error-message.js'

export type ComposerContinuePillProps = {
  messageId: string
  runningTurn: boolean
  onContinue: () => Promise<void>
  onError: (message: string) => void
}

const TITLE_IDLE = 'Continue this conversation in a new tab with a fresh context window'
const TITLE_BUSY = 'Wait for the current turn to finish'

/** Full-conversation handoff; lives under the composer so it stays visible after long threads. */
export function ComposerContinuePill({ messageId, runningTurn, onContinue, onError }: ComposerContinuePillProps): JSX.Element {
  const [busy, setBusy] = useState(false)
  const disabled = runningTurn || busy
  return (
    <button
      type="button"
      className="composer-pill composer-pill-continue"
      data-ui="composer.continue"
      data-ui-key={messageId}
      disabled={disabled}
      title={disabled && runningTurn ? TITLE_BUSY : TITLE_IDLE}
      aria-label="Continue in new chat with fresh context"
      onClick={() => {
        setBusy(true)
        void onContinue().catch((cause) => onError(errorMessage(cause, 'Could not continue in a new chat.')))
          .finally(() => setBusy(false))
      }}
    >
      <MessageSquareShare size={14} strokeWidth={1.9} aria-hidden="true" />
      <span className="composer-pill-label">Fresh context</span>
    </button>
  )
}
