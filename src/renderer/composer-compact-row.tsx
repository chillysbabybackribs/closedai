import type { ClipboardEvent, JSX } from 'react'
import { ChevronUp, Pause, Play } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import { PromptInputAction, PromptInputTextarea } from '../components/ui/prompt-input.js'
import type { ChatProvider } from '../shared/chat.js'
import { CHAT_PROVIDER_LABELS } from '../shared/chat-providers.js'
import { TurnActivityIndicator } from './task-activity.js'

export type ComposerCompactRowProps = {
  running: boolean
  activeTurnId: string | null
  selectedModel: string | null
  provider: ChatProvider
  placeholder?: string
  enabled: boolean
  sending: boolean
  paused: boolean
  canSend: boolean
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onFocus: () => void
  onBlur: () => void
  onStop: () => Promise<void>
  onResume: () => Promise<void>
  onExpand: () => void
}

export function ComposerCompactRow({
  running,
  activeTurnId,
  selectedModel,
  provider,
  placeholder,
  enabled,
  sending,
  paused,
  canSend,
  onPaste,
  onFocus,
  onBlur,
  onStop,
  onResume,
  onExpand
}: ComposerCompactRowProps): JSX.Element {
  return (
    <div className="prompt-composer-compact-row">
      {running ? (
        <div className="prompt-composer-compact-status">
          <TurnActivityIndicator activeTurnId={activeTurnId} />
        </div>
      ) : (
        <div className="prompt-composer-compact-model">
          <span>{selectedModel ? selectedModel.replace(/^(agy:|claude:)/, '') : CHAT_PROVIDER_LABELS[provider]}</span>
        </div>
      )}
      <PromptInputTextarea
        aria-label="Message Codex"
        data-ui="composer.input"
        data-can-send={canSend || undefined}
        placeholder={placeholder ?? (running ? 'Working on task…' : enabled ? 'Ask anything' : 'Codex is unavailable')}
        spellCheck={false}
        disableAutosize
        className="prompt-composer-textarea prompt-composer-textarea-compact"
        onPaste={onPaste}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <div className="prompt-composer-compact-actions">
        {running ? (
          <PromptInputAction tooltip={`Pause ${CHAT_PROVIDER_LABELS[provider]}`}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="prompt-composer-stop rounded-full"
              aria-label={`Pause ${CHAT_PROVIDER_LABELS[provider]}`}
              data-ui="composer.stop"
              onClick={(event) => {
                event.stopPropagation()
                void onStop()
              }}
            >
              <Pause size={17} strokeWidth={2.25} aria-hidden="true" />
            </Button>
          </PromptInputAction>
        ) : paused ? (
          <PromptInputAction tooltip={`Resume where ${CHAT_PROVIDER_LABELS[provider]} paused`}>
            <Button
              type="button"
              size="icon"
              className="prompt-composer-resume rounded-full"
              aria-label={`Resume where ${CHAT_PROVIDER_LABELS[provider]} paused`}
              data-ui="composer.resume"
              disabled={!enabled || sending}
              onClick={(event) => {
                event.stopPropagation()
                void onResume()
              }}
            >
              <Play size={15} fill="currentColor" aria-hidden="true" />
            </Button>
          </PromptInputAction>
        ) : null}
        <PromptInputAction tooltip="Expand composer">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="prompt-composer-toggle-compact rounded-full"
            aria-label="Expand composer"
            data-ui="composer.compact-toggle"
            onClick={(event) => {
              event.stopPropagation()
              onExpand()
            }}
          >
            <ChevronUp size={15} aria-hidden="true" />
          </Button>
        </PromptInputAction>
      </div>
    </div>
  )
}
