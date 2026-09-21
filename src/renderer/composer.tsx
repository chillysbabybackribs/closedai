import type { ClipboardEvent, DragEvent, FormEvent, JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Pause, Play, Plus } from 'lucide-react'

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
import { ComposerCompactRow } from './composer-compact-row.js'
import { useComposerLayout } from './composer-layout.js'
import { useComposerDraft } from './composer-drafts.js'
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
  projectPending?: boolean
  recentProjects: Array<{ cwd: string; projectPath: string }>
  onChooseProject: () => Promise<void>
  onSelectProject: (projectPath: string) => Promise<void>
  onClearProject: () => Promise<void>
  /** Turn in flight, if any; shown as the working timer on the project rail. */
  activeTurnId: string | null
  onCompactConversation?: () => Promise<void>
  compactConversationEnabled?: boolean
  paneId?: string | null
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
  onNewChat, cwd, projectPath, projectPending, recentProjects,
  onChooseProject, onSelectProject, onClearProject,
  activeTurnId, onCompactConversation, compactConversationEnabled = false, paneId
}: ComposerProps): JSX.Element {
  const { input, setInput, attachments, setAttachments, clearDraft } = useComposerDraft(paneId)
  const [attachmentError, setAttachmentError] = useState('')
  const [sending, setSending] = useState(false)
  // Only the chevron changes modes: typing, focusing, and sending all stay in the mode the user
  // chose, so a collapsed composer keeps its one-line footprint across turns, new chats, and restarts.
  const [layout, setLayout] = useComposerLayout()
  const isCompact = layout === 'compact'
  const inputPlaceholder = running
    ? 'Esc to pause'
    : placeholder ?? (enabled ? 'Enter to send · Shift+Enter for newline' : 'Codex is unavailable')
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const focusAfterSendRef = useRef(false)
  // Compact and full mode render different textareas. Toggling unmounts the focused one; carry
  // focus across so the caret is not lost.
  const textareaFocusedRef = useRef(false)
  useEffect(() => {
    if (textareaFocusedRef.current) formRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [isCompact])
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !sending && enabled && !running

  useEffect(() => {
    if (sending || !focusAfterSendRef.current) return
    focusAfterSendRef.current = false
    formRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [sending])

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
      className={`prompt-composer${isCompact ? ' is-compact' : ''}`}
      onSubmit={(event) => void submit(event)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={dropFiles}
    >
      {/* Collapsed, the pill has no room for chips, so attachments sit above it beside the
          project rail; the rail itself stays in both modes because it says where the turn runs. */}
      {isCompact && (
        <div className="prompt-composer-compact-attachments">
          <AttachmentChips
            attachments={attachments}
            onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))}
          />
          {attachmentError && <div className="prompt-attachment-error" role="alert">{attachmentError}</div>}
        </div>
      )}
      <ProjectMenu
        cwd={cwd}
        projectPath={projectPath}
        pending={projectPending}
        recentProjects={recentProjects}
        disabled={sending}
        onChooseProject={onChooseProject}
        onSelectProject={onSelectProject}
        onClearProject={onClearProject}
        activeTurnId={activeTurnId}
        trailing={isCompact ? undefined : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="prompt-composer-toggle-compact rounded-full"
            aria-label="Collapse composer"
            title="Collapse composer"
            data-ui="composer.compact-toggle"
            onClick={(event) => {
              event.stopPropagation()
              setLayout('compact')
            }}
          >
            <ChevronDown size={15} aria-hidden="true" />
          </Button>
        )}
      />
      <PromptInput
        value={input}
        onValueChange={setInput}
        onSubmit={() => void submit()}
        isLoading={running || sending}
        disabled={!enabled || sending}
        maxHeight={isCompact ? 28 : 'var(--composer-max-height, min(36vh, 240px))'}
        className={`prompt-composer-input${isCompact ? ' is-compact' : ''}`}
      >
        {isCompact ? (
          <ComposerCompactRow
            running={running}
            activeTurnId={activeTurnId}
            selectedModelLabel={models.find((model) => model.id === selectedModel)?.displayName ?? null}
            provider={provider}
            placeholder={inputPlaceholder}
            enabled={enabled}
            sending={sending}
            paused={paused}
            canSend={canSend}
            onPaste={pasteFiles}
            onFocus={() => { textareaFocusedRef.current = true }}
            onBlur={() => { textareaFocusedRef.current = false }}
            onStop={onStop}
            onResume={resume}
            onExpand={() => setLayout('full')}
          />
        ) : (
          <div className="prompt-composer-body">
            <div className="prompt-composer-column">
              <AttachmentChips
                attachments={attachments}
                onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))}
              />
              <PromptInputTextarea
                aria-label="Message Codex"
                data-ui="composer.input"
                data-can-send={canSend || undefined}
                placeholder={inputPlaceholder}
                spellCheck={false}
                className="prompt-composer-textarea"
                onPaste={pasteFiles}
                onFocus={() => { textareaFocusedRef.current = true }}
                onBlur={() => { textareaFocusedRef.current = false }}
              />

              {attachmentError && <div className="prompt-attachment-error" role="alert">{attachmentError}</div>}

              <PromptInputActions className="prompt-composer-actions">
                <div className="prompt-composer-actions-start">
                  <PromptInputAction tooltip="New chat tab">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="prompt-composer-tool prompt-composer-new-chat rounded-full"
                      aria-label="New chat tab"
                      data-ui="composer.new-chat"
                      disabled={!enabled}
                      onClick={onNewChat}
                    >
                      <Plus size={21} strokeWidth={2.6} aria-hidden="true" />
                    </Button>
                  </PromptInputAction>

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
                      contextUsage={contextUsage}
                      provider={provider}
                      planUsage={planUsage}
                      onInspectContext={onInspectContext}
                      onRefreshPlanUsage={onRefreshPlanUsage}
                      onCompactConversation={onCompactConversation}
                      compactConversationEnabled={compactConversationEnabled}
                      onModelChange={onModelChange}
                      onReasoningEffortChange={onReasoningEffortChange}
                    />
                  </div>
                </div>

                <div className="prompt-composer-actions-end">
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
                </div>
              </PromptInputActions>
            </div>

            {/* Enter is the only way to send; the pause control sits in its own column so it
                centres on the card's full height rather than the action row. */}
            {running ? (
              <div className="prompt-composer-primary">
                <PromptInputAction tooltip={`Pause ${CHAT_PROVIDER_LABELS[provider]} (Esc)`}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="prompt-composer-stop rounded-full"
                    aria-label={`Pause ${CHAT_PROVIDER_LABELS[provider]} (Esc)`}
                    data-ui="composer.stop"
                    onClick={() => void onStop()}
                  >
                    <Pause size={24} strokeWidth={2.25} aria-hidden="true" />
                  </Button>
                </PromptInputAction>
              </div>
            ) : null}
          </div>
        )}
      </PromptInput>
    </form>
  )
}
