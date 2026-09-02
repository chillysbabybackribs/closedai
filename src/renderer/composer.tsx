import type { ClipboardEvent, DragEvent, FormEvent, JSX } from 'react'
import { useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Mic, Square } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea
} from '../components/ui/prompt-input.js'
import type { ChatAttachment, ChatModel } from '../shared/chat.js'
import { AttachmentChips, AttachmentPicker, attachmentsFromFiles } from './composer-attachments.js'

export type ComposerProps = {
  enabled: boolean
  running: boolean
  models: ChatModel[]
  selectedModel: string | null
  selectedReasoningEffort: string | null
  onModelChange: (modelId: string) => Promise<void>
  onReasoningEffortChange: (effort: string) => Promise<void>
  onSend: (text: string, attachments: ChatAttachment[]) => Promise<void>
  onStop: () => Promise<void>
}

export function Composer({ enabled, running, models, selectedModel, selectedReasoningEffort, onModelChange, onReasoningEffortChange, onSend, onStop }: ComposerProps): JSX.Element {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !sending && enabled && !running

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
            <div className="flex items-center gap-2">
              <AttachmentPicker
                disabled={!enabled || running || sending}
                inputRef={fileInputRef}
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files)
                  event.target.value = ''
                }}
              />

              <ModelPicker
                enabled={enabled && !running}
                models={models}
                selectedModel={selectedModel}
                onChange={onModelChange}
              />
              <ReasoningEffortPicker
                enabled={enabled && !running}
                model={models.find((model) => model.id === selectedModel)}
                selectedEffort={selectedReasoningEffort}
                onChange={onReasoningEffortChange}
              />
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
                    disabled={!canSend}
                  >
                    <ArrowUp size={18} aria-hidden="true" />
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

function ReasoningEffortPicker({
  enabled,
  model,
  selectedEffort,
  onChange
}: {
  enabled: boolean
  model: ChatModel | undefined
  selectedEffort: string | null
  onChange: (effort: string) => Promise<void>
}): JSX.Element | null {
  if (!model?.supportedReasoningEfforts.length) return null
  const selected = model.supportedReasoningEfforts.find((option) => option.reasoningEffort === selectedEffort)
  return (
    <label className="prompt-model-picker prompt-effort-picker" title={selected?.description || 'Choose reasoning effort'}>
      <span className="sr-only">Reasoning effort</span>
      <select
        aria-label="Reasoning effort"
        value={selectedEffort ?? ''}
        disabled={!enabled}
        onChange={(event) => { void onChange(event.target.value).catch(() => {}) }}
      >
        {!selectedEffort && <option value="">Choose effort</option>}
        {model.supportedReasoningEfforts.map((option) => (
          <option key={option.reasoningEffort} value={option.reasoningEffort}>
            {displayEffort(option.reasoningEffort)}
          </option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  )
}

function displayEffort(effort: string): string {
  return effort.split(/[-_]/).map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : '').join(' ')
}

function ModelPicker({
  enabled,
  models,
  selectedModel,
  onChange
}: {
  enabled: boolean
  models: ChatModel[]
  selectedModel: string | null
  onChange: (modelId: string) => Promise<void>
}): JSX.Element {
  const selected = models.find((model) => model.id === selectedModel)
  return (
    <label className="prompt-model-picker" title={selected?.description || 'Choose a Codex model'}>
      <span className="sr-only">Codex model</span>
      <select
        aria-label="Codex model"
        value={selectedModel ?? ''}
        disabled={!enabled || models.length === 0}
        onChange={(event) => { void onChange(event.target.value).catch(() => {}) }}
      >
        {!selectedModel && <option value="">Choose model</option>}
        {models.map((model) => (
          <option key={model.id} value={model.id}>{model.displayName}</option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
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
