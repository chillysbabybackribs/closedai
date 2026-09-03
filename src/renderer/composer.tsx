import type { ClipboardEvent, DragEvent, FormEvent, JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Plus, Square } from 'lucide-react'

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
  /** Replaces the default prompt, e.g. with connection progress while the provider starts. */
  placeholder?: string
  models: ChatModel[]
  selectedModel: string | null
  selectedReasoningEffort: string | null
  /** How full the model's window was after the latest response; null before the first one. */
  contextUsage: ChatContextUsage | null
  onModelChange: (modelId: string) => Promise<void>
  onReasoningEffortChange: (effort: string) => Promise<void>
  onSend: (text: string, attachments: ChatAttachment[]) => Promise<void>
  onStop: () => Promise<void>
  onNewChat?: () => void
}

export function Composer({
  enabled,
  running,
  placeholder,
  models,
  selectedModel,
  selectedReasoningEffort,
  contextUsage,
  onModelChange,
  onReasoningEffortChange,
  onSend,
  onStop,
  onNewChat
}: ComposerProps): JSX.Element {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [sending, setSending] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const focusAfterSendRef = useRef(false)
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !sending && enabled && !running
  const waitingForInput = input.trim().length === 0 && attachments.length === 0 && enabled && !running && !sending

  useEffect(() => {
    if (sending || !focusAfterSendRef.current) return
    focusAfterSendRef.current = false
    formRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [sending])

  function handleNewChat(): void {
    setInput('')
    setAttachments([])
    setAttachmentError('')
    onNewChat?.()
  }

  async function submit(event?: FormEvent): Promise<void> {
    event?.preventDefault()
    if (!canSend) return
    setSending(true)
    try {
      await onSend(input.trim(), attachments)
      setInput('')
      setAttachments([])
      setAttachmentError('')
      focusAfterSendRef.current = true
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
      ref={formRef}
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
            placeholder={placeholder ?? (enabled ? 'Ask anything' : 'Codex is unavailable')}
            spellCheck={false}
            className="prompt-composer-textarea"
            onPaste={pasteFiles}
          />

          {attachmentError && <div className="prompt-attachment-error" role="alert">{attachmentError}</div>}

          <PromptInputActions className="prompt-composer-actions">
            <div className="flex items-center gap-1">
              <PromptInputAction tooltip="New chat">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="prompt-composer-tool prompt-composer-new-chat rounded-full"
                  aria-label="New chat"
                  disabled={!enabled}
                  onClick={handleNewChat}
                >
                  <Plus size={21} strokeWidth={2.6} aria-hidden="true" />
                </Button>
              </PromptInputAction>

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
              <AttachmentPicker
                disabled={!enabled || running || sending}
                inputRef={fileInputRef}
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files)
                  event.target.value = ''
                }}
              />

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
                    <Square size={16} fill="currentColor" aria-hidden="true" />
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
                    <ArrowUp size={19} strokeWidth={2} aria-hidden="true" />
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
