import type { ClipboardEvent, DragEvent, FormEvent, JSX, Ref } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Play, Square } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import { PromptInput, PromptInputAction, PromptInputTextarea } from '../components/ui/prompt-input.js'
import type { ChatAttachment, ChatContextUsage, ChatModel, ChatPlanUsage, ChatProvider } from '../shared/chat.js'
import { CHAT_PROVIDER_LABELS } from '../shared/chat-providers.js'
import { AttachmentChips, AttachmentPicker, attachmentsFromFiles } from './composer-attachments.js'
import { ComposerFolderMenu } from './composer-folder-menu.js'
import { ComposerSetupMenu, type ComposerSetupHandle } from './composer-setup-menu.js'
import { useComposerDraft } from './composer-drafts.js'
import { errorMessage } from './error-message.js'

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
  /** Which provider's plan the usage section names. */
  provider: ChatProvider
  /** The account's subscription windows, shown beside the context window in the setup panel. */
  planUsage: ChatPlanUsage | null
  onRefreshPlanUsage: () => Promise<void>
  onModelChange: (modelId: string) => Promise<void>
  onReasoningEffortChange: (effort: string) => Promise<void>
  onSend: (text: string, attachments: ChatAttachment[]) => Promise<void>
  onStop: () => Promise<void>
  /** A turn the pause button ended and nothing has followed, so Resume is worth offering. */
  paused: boolean
  onResume: () => Promise<void>
  cwd: string
  projectPath: string | null
  projectPending?: boolean
  recentProjects: Array<{ cwd: string; projectPath: string }>
  onChooseProject: () => Promise<void>
  onSelectProject: (projectPath: string) => Promise<void>
  onClearProject: () => Promise<void>
  onCompactConversation?: () => Promise<void>
  compactConversationEnabled?: boolean
  paneId?: string | null
  /** Lets the pane's connection guidance open the setup panel on its model list. */
  setupMenuRef?: Ref<ComposerSetupHandle>
}

/**
 * The message card contains the draft and its actions. The setup trigger sits below it so the
 * selected model and folder read as metadata for the composer rather than taking space from the
 * writing surface; the trigger still opens the full setup panel.
 */
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
  cwd, projectPath, projectPending, recentProjects,
  onChooseProject, onSelectProject, onClearProject,
  onCompactConversation, compactConversationEnabled = false, paneId, setupMenuRef
}: ComposerProps): JSX.Element {
  const { input, setInput, attachments, setAttachments, clearDraft } = useComposerDraft(paneId)
  // One alert row for whatever the composer's own controls could not do: attach, pause, pick.
  const [composerError, setComposerError] = useState('')
  const providerLabel = CHAT_PROVIDER_LABELS[provider]
  const [sending, setSending] = useState(false)
  // Blank while a turn runs: the pause button is the affordance then, and a hint would compete.
  const inputPlaceholder = running
    ? ''
    : placeholder ?? (enabled
      ? (paused ? 'Resume, or send something new' : `Message ${providerLabel}`)
      : `${providerLabel} is unavailable`)
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const focusAfterSendRef = useRef(false)
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !sending && enabled && !running

  useEffect(() => {
    if (sending || !focusAfterSendRef.current) return
    focusAfterSendRef.current = false
    formRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [sending])

  async function stop(): Promise<void> {
    try {
      await onStop()
    } catch (error) {
      setComposerError(errorMessage(error, `Could not pause ${providerLabel}`))
    }
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
    clearDraft()
    setComposerError('')
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
    setComposerError(result.errors[0] ?? '')
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

  const action = running ? (
    <PromptInputAction tooltip={`Pause ${providerLabel} (Esc)`} disabled={false}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="composer-action composer-stop"
        aria-label={`Pause ${providerLabel} (Esc)`}
        data-ui="composer.stop"
        onClick={() => void stop()}
      >
        <Square size={12} fill="currentColor" aria-hidden="true" />
      </Button>
    </PromptInputAction>
  ) : paused ? (
    <PromptInputAction tooltip={`Resume where ${providerLabel} paused`}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="composer-action composer-resume"
        aria-label={`Resume where ${providerLabel} paused`}
        data-ui="composer.resume"
        disabled={!enabled || sending}
        onClick={() => void resume()}
      >
        <Play size={13} fill="currentColor" aria-hidden="true" />
      </Button>
    </PromptInputAction>
  ) : (
    <PromptInputAction tooltip="Send (Enter)">
      <Button
        type="submit"
        size="icon"
        className="composer-action composer-send"
        aria-label={`Send to ${providerLabel} (Enter)`}
        data-ui="composer.send"
        disabled={!canSend}
      >
        <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />
      </Button>
    </PromptInputAction>
  )

  return (
    <form
      ref={formRef}
      className="composer"
      onSubmit={(event) => void submit(event)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={dropFiles}
    >
      <div className="composer-stack">
        <PromptInput
          value={input}
          onValueChange={setInput}
          onSubmit={() => void submit()}
          isLoading={running || sending}
          disabled={!enabled || sending}
          maxHeight="var(--composer-max-height, min(36vh, 240px))"
          className="composer-card"
        >
          {attachments.length > 0 && (
            <AttachmentChips
              attachments={attachments}
              onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))}
            />
          )}
          <div className="composer-row">
            <PromptInputTextarea
              aria-label={`Message ${providerLabel}`}
              data-ui="composer.input"
              data-can-send={canSend || undefined}
              placeholder={inputPlaceholder}
              spellCheck={false}
              rows={1}
              className="composer-textarea"
              onPaste={pasteFiles}
            />
            {action}
          </div>
        </PromptInput>
        <div className="composer-footer">
          <div className="composer-footer-attach">
            <AttachmentPicker
              disabled={!enabled || running || sending}
              inputRef={fileInputRef}
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files)
                event.target.value = ''
              }}
            />
          </div>
          <div className="composer-footer-setup">
            <ComposerSetupMenu
              ref={setupMenuRef}
              modelsEnabled={enabled && !running}
              models={models}
              selectedModel={selectedModel}
              selectedReasoningEffort={selectedReasoningEffort}
              onModelChange={onModelChange}
              onReasoningEffortChange={onReasoningEffortChange}
              onError={setComposerError}
              contextUsage={contextUsage}
              provider={provider}
              planUsage={planUsage}
              onRefreshPlanUsage={onRefreshPlanUsage}
              onCompact={onCompactConversation}
              compactEnabled={compactConversationEnabled}
            />
            <ComposerFolderMenu
              busy={sending}
              cwd={cwd}
              projectPath={projectPath}
              projectPending={projectPending}
              recentProjects={recentProjects}
              onChooseProject={onChooseProject}
              onSelectProject={onSelectProject}
              onClearProject={onClearProject}
              onError={setComposerError}
            />
          </div>
        </div>
      </div>
      {composerError && <div className="prompt-attachment-error" role="alert">{composerError}</div>}
    </form>
  )
}
