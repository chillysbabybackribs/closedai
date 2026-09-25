import type { JSX } from 'react'
import { useState } from 'react'
import { MessageSquareShare } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { errorMessage } from './error-message.js'

export type ComposerContinuePillProps = {
  messageId: string
  runningTurn: boolean
  /** Show the words, not only the icon: the context window is filling up. */
  labelled?: boolean
  onContinue: () => Promise<void>
  onError: (message: string) => void
}

const TITLE_IDLE = 'Continue this conversation in a new tab with a fresh context window'
const TITLE_BUSY = 'Wait for the current turn to finish'

/** Full-conversation handoff; lives in the composer capsule so it stays visible after long threads. */
export function ComposerContinuePill({ messageId, runningTurn, labelled = false, onContinue, onError }: ComposerContinuePillProps): JSX.Element {
  const [busy, setBusy] = useState(false)
  const disabled = runningTurn || busy
  return (
    <button
      type="button"
      className={cn('composer-tool', labelled && 'composer-chip composer-chip-continue')}
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
      <MessageSquareShare size={15} strokeWidth={1.9} aria-hidden="true" />
      {labelled && <span className="composer-chip-label">Fresh context</span>}
    </button>
  )
}
