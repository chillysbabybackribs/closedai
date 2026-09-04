import type { ClipboardEvent, DragEvent, FormEvent, JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Pause, Play, Plus } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea
} from '../components/ui/prompt-input.js'
import type { ChatAttachment, ChatContextUsage, ChatModel, ChatPlanUsage, ChatProvider } from '../shared/chat.js'
import { CHAT_PROVIDER_LABELS } from '../shared/chat-providers.js'
import { AttachmentChips, AttachmentPicker, attachmentsFromFiles } from './composer-attachments.js'
import { ContextMeter } from './context-meter.js'
import { ModelMenu } from './model-menu.js'
import { ProjectMenu } from './project-menu.js'

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
  /** Which provider's plan the usage card names. */
  provider: ChatProvider
  /** The account's subscription windows, shown beside the context window on hover. */
  planUsage: ChatPlanUsage | null
  onRefreshPlanUsage: () => Promise<void>
  onModelChange: (modelId: string) => Promise<void>
  onReasoningEffortChange: (effort: string) => Promise<void>
  onSend: (text: string, attachments: ChatAttachment[]) => Promise<void>
  onStop: () => Promise<void>
  /** A turn the pause button ended and nothing has followed, so Resume is worth offering. */
  paused: boolean
  onResume: () => Promise<void>
  onInspectContext: () => void
  onNewChat?: () => void
  cwd: string
  projectPath: string | null
  recentProjects: Array<{ cwd: string; projectPath: string }>
  onChooseProject: () => Promise<void>
  onSelectProject: (projectPath: string) => Promise<void>
  onClearProject: () => Promise<void>
  onOpenTools: () => void
  onOpenTrace: () => void
  /** Turn in flight, if any; shown as the working timer on the project rail. */
  activeTurnId: string | null
  onCompactConversation?: () => Promise<void>
  compactConversationEnabled?: boolean
}

export function Composer({
  enabled,
  running,
  placeholder,
  models,
  selectedModel,
  selectedReasoningEffort,
  contextUsage,
  provider,
  planUsage,
  onRefreshPlanUsage,
  onModelChange,
  onReasoningEffortChange,
  onSend,
  onStop,
  paused,
  onResume,
  onInspectContext,
  onNewChat,
  cwd,
  projectPath,
  recentProjects,
  onChooseProject,
  onSelectProject,
  onClearProject,
  onOpenTools,
  onOpenTrace,
  activeTurnId,
  onCompactConversation,
  compactConversationEnabled = false
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

  /** Resume is an ordinary turn, so it shares the send guard rather than racing one. */
  async function resume(): Promise<void> {
    if (sending || !enabled || running) return
    setSending(true)
    try {
      await onResume()
    } finally {
      setSending(false)
    }
  }

  async function submit(event?: FormEvent): Promise<void> {
    event?.preventDefault()
    if (!canSend) return
    const submittedInput = input.trim()
    const submittedAttachments = attachments
    setSending(true)
    // Every provider paints an optimistic transcript item before its process or thread is ready,
    // so the composer empties on submit. Holding the draft until the send resolved was the visible
    // half of a slow first message: the text sat in the box and the chat stayed empty.
    setInput('')
    setAttachments([])
    setAttachmentError('')
    try {
      await onSend(submittedInput, submittedAttachments)
      focusAfterSendRef.current = true
    } catch {
      // The message stays in the transcript and main adds the notice explaining what failed.
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
      <ProjectMenu
        cwd={cwd}
        projectPath={projectPath}
        recentProjects={recentProjects}
        disabled={!enabled || running || sending}
        onChooseProject={onChooseProject}
        onSelectProject={onSelectProject}
        onClearProject={onClearProject}
        onOpenTools={onOpenTools}
        onOpenTrace={onOpenTrace}
        activeTurnId={activeTurnId}
      />
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
            data-ui="composer.input"
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
                  data-ui="composer.new-chat"
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
                <ContextMeter
                  usage={contextUsage}
                  provider={provider}
                  planUsage={planUsage}
                  onInspect={onInspectContext}
                  onRefreshPlanUsage={onRefreshPlanUsage}
                  onCompact={onCompactConversation}
                  compactEnabled={compactConversationEnabled}
                />
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

              {!running && paused ? (
                <PromptInputAction tooltip={`Resume where ${CHAT_PROVIDER_LABELS[provider]} paused`}>
                  <Button
                    type="button"
                    size="icon"
                    className="prompt-composer-resume rounded-full"
                    aria-label={`Resume where ${CHAT_PROVIDER_LABELS[provider]} paused`}
                    data-ui="composer.resume"
                    disabled={!enabled || sending}
                    onClick={() => void resume()}
                  >
                    <Play size={15} fill="currentColor" aria-hidden="true" />
                  </Button>
                </PromptInputAction>
              ) : null}

              {running ? (
                <PromptInputAction tooltip={`Pause ${CHAT_PROVIDER_LABELS[provider]}`}>
                  <Button
                    type="button"
                    size="icon"
                    className="prompt-composer-stop rounded-full"
                    aria-label={`Pause ${CHAT_PROVIDER_LABELS[provider]}`}
                    data-ui="composer.stop"
                    onClick={() => void onStop()}
                  >
                    <Pause size={15} fill="currentColor" aria-hidden="true" />
                  </Button>
                </PromptInputAction>
              ) : (
                <PromptInputAction tooltip="Send message">
                  <Button
                    type="submit"
                    size="icon"
                    className="prompt-composer-send rounded-full"
                    aria-label="Send message"
                    data-ui="composer.send"
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
