import type { ClipboardEvent, DragEvent, FormEvent, JSX } from 'react'
import { useRef, useState } from 'react'
import { ArrowRight, Mic, Square } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea
} from '../components/ui/prompt-input.js'
import type { ChatAttachment, ChatContextUsage, ChatModel } from '../shared/chat.js'
import { AttachmentChips, AttachmentPicker, attachmentsFromFiles } from './composer-attachments.js'
import { ContextMeter } from './context-meter.js'
import { ModelMenu } from './model-menu.js'

export type ComposerProps = {
  enabled: boolean
  running: boolean
  models: ChatModel[]
  selectedModel: string | null
  selectedReasoningEffort: string | null
  /** How full the model's window was after the latest response; null before the first one. */
  contextUsage: ChatContextUsage | null
  onModelChange: (modelId: string) => Promise<void>
  onReasoningEffortChange: (effort: string) => Promise<void>
  onSend: (text: string, attachments: ChatAttachment[]) => Promise<void>
  onStop: () => Promise<void>
}

export function Composer({ enabled, running, models, selectedModel, selectedReasoningEffort, contextUsage, onModelChange, onReasoningEffortChange, onSend, onStop }: ComposerProps): JSX.Element {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !sending && enabled && !running
  const waitingForInput = input.trim().length === 0 && attachments.length === 0 && enabled && !running && !sending

  async function submit(event?: FormEvent): Promise<void> {
    event?.preventDefault()
    if (!canSend) return
    setSending(true)
    try {
      await onSend(input.trim(), attachments)
      setInput('')
      setAttachments([])
      setAttachmentError('')
    } catch {
      // The main process adds an actionable transcript notice. Preserve the draft.
    } finally {
      setSending(false)
    }
  }

  async function addFiles(files: FileList | File[]): Promise<void> {
    const result = await attachmentsFromFiles(files)
    setAttachments((current) => {
      const available = Math.max(0, 20 - current.length)
      if (result.attachments.length > available) result.errors.push('Attach no more than 20 files at once')
      return [...current, ...result.attachments.slice(0, available)]
    })
    setAttachmentError(result.errors[0] ?? '')
  }

  function pasteFiles(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (!event.clipboardData.files.length) return
    event.preventDefault()
    void addFiles(event.clipboardData.files)
  }

  function dropFiles(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
  }

  return (
    <form
      className="prompt-composer"
      onSubmit={(event) => void submit(event)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={dropFiles}
    >
      <PromptInput
        value={input}
        onValueChange={setInput}
        onSubmit={() => void submit()}
        isLoading={running || sending}
        disabled={!enabled || sending}
        maxHeight="min(36vh, 240px)"
        className="prompt-composer-input"
      >
        <div className="flex flex-col">
          <AttachmentChips
            attachments={attachments}
            onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))}
          />
          <PromptInputTextarea
            aria-label="Message Codex"
            placeholder={enabled ? 'Ask anything' : 'Codex is unavailable'}
            spellCheck={false}
            className="prompt-composer-textarea"
            onPaste={pasteFiles}
          />

          {attachmentError && <div className="prompt-attachment-error" role="alert">{attachmentError}</div>}

          <PromptInputActions className="prompt-composer-actions">
            <div className="flex items-center gap-1">
              <AttachmentPicker
                disabled={!enabled || running || sending}
                inputRef={fileInputRef}
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files)
                  event.target.value = ''
                }}
              />

              <div className="prompt-model-controls">
                <ModelMenu
                  enabled={enabled && !running}
                  models={models}
                  selectedModel={selectedModel}
                  selectedReasoningEffort={selectedReasoningEffort}
                  onModelChange={onModelChange}
                  onReasoningEffortChange={onReasoningEffortChange}
                />
                {contextUsage && <ContextMeter usage={contextUsage} />}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <PlaceholderAction tooltip="Voice input (coming soon)" label="Voice input">
                <Mic size={18} aria-hidden="true" />
              </PlaceholderAction>

              {running ? (
                <PromptInputAction tooltip="Stop Codex">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="prompt-composer-stop"
                    aria-label="Stop Codex"
                    onClick={() => void onStop()}
                  >
                    <Square className="size-3.5" fill="currentColor" aria-hidden="true" />
                  </Button>
                </PromptInputAction>
              ) : (
                <PromptInputAction tooltip="Send message">
                  <Button
                    type="submit"
                    size="icon"
                    className="prompt-composer-send"
                    aria-label="Send message"
                    data-waiting-for-input={waitingForInput || undefined}
                    disabled={!canSend}
                  >
                    <ArrowRight size={18} aria-hidden="true" />
                  </Button>
                </PromptInputAction>
              )}
            </div>
          </PromptInputActions>
        </div>
      </PromptInput>
    </form>
  )
}

/** Round outline icon button for actions that have no feature behind them yet. */
function PlaceholderAction({
  tooltip,
  label,
  children
}: {
  tooltip: string
  label: string
  children: JSX.Element
}): JSX.Element {
  return (
    <PromptInputAction tooltip={tooltip}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="prompt-composer-tool rounded-full"
        aria-label={label}
        disabled
      >
        {children}
      </Button>
    </PromptInputAction>
  )
}
