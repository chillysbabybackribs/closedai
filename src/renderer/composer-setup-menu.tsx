import { useCallback, useImperativeHandle, useRef, useState, type JSX, type Ref } from 'react'
import { Popover } from 'radix-ui'

import { ProviderMark } from '../components/ui/provider-mark.js'
import type { ChatContextUsage, ChatModel, ChatPlanUsage, ChatProvider } from '../shared/chat.js'
import { ContextSection, EffortSection, FolderSection, ModelSection, folderName } from './composer-setup-sections.js'
import { errorMessage } from './error-message.js'
import { countModelUse, modelTriggerLabel, parseModelUsage, providerSections, type ModelUsage } from './model-menu-state.js'

const MODEL_USAGE_KEY = 'closedai.composer.modelUsage'

/** Opens the panel from outside its trigger, e.g. the empty pane's "Choose model" hint. */
export type ComposerSetupHandle = { open: () => void }

export type ComposerSetupMenuProps = {
  ref?: Ref<ComposerSetupHandle>
  /** Model and effort can change; false while a turn runs or the provider is unavailable. */
  modelsEnabled: boolean
  /** A send is in flight, so folder changes wait. */
  busy: boolean
  models: ChatModel[]
  selectedModel: string | null
  selectedReasoningEffort: string | null
  onModelChange: (modelId: string) => Promise<void>
  onReasoningEffortChange: (effort: string) => Promise<void>
  /** Where a failed change is shown: the composer's alert row. */
  onError: (message: string) => void
  cwd: string
  projectPath: string | null
  projectPending?: boolean
  recentProjects: Array<{ cwd: string; projectPath: string }>
  onChooseProject: () => Promise<void>
  onSelectProject: (projectPath: string) => Promise<void>
  onClearProject: () => Promise<void>
  contextUsage: ChatContextUsage | null
  provider: ChatProvider
  planUsage: ChatPlanUsage | null
  onRefreshPlanUsage: () => Promise<void>
  onCompact?: () => Promise<void>
  compactEnabled: boolean
}

/**
 * The metadata trigger below the composer and the one panel behind it. The trigger names the
 * model on the left and folder on the right; the panel holds every per-chat setting — model,
 * reasoning effort, folder, context and plan usage — as sections of one surface. The chat pane is
 * the collision boundary.
 */
export function ComposerSetupMenu({
  ref,
  modelsEnabled,
  busy,
  models,
  selectedModel,
  selectedReasoningEffort,
  onModelChange,
  onReasoningEffortChange,
  onError,
  cwd,
  projectPath,
  projectPending = false,
  recentProjects,
  onChooseProject,
  onSelectProject,
  onClearProject,
  contextUsage,
  provider,
  planUsage,
  onRefreshPlanUsage,
  onCompact,
  compactEnabled
}: ComposerSetupMenuProps): JSX.Element {
  const [usage, recordModelUse] = useModelUsage()
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Set when a model row closes the panel, so the following close-focus lands in the composer
  // textarea rather than snapping back to the trigger the way Radix would by default.
  const focusInputOnCloseRef = useRef(false)
  // Resolved when the panel opens: the column it must stay inside, never the window.
  const [boundary, setBoundary] = useState<Element | null>(null)
  const [open, setOpenState] = useState(false)
  const setOpen = useCallback((next: boolean): void => {
    setOpenState(next)
    if (next) {
      setBoundary(triggerRef.current?.closest('.chat-pane') ?? null)
      // The plan windows are asked for fresh each time the panel opens, mid-turn included.
      void onRefreshPlanUsage()
    }
  }, [onRefreshPlanUsage])
  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), [setOpen])

  const trigger = modelTriggerLabel(models, selectedModel, selectedReasoningEffort)
  const selected = models.find((model) => model.id === selectedModel)
  const folder = projectPath ? folderName(projectPath) : null
  const chooseModel = (value: string): void => {
    recordModelUse(value)
    // Picking a model ends the setup step: close the panel and hand focus to the composer so the
    // user can start typing without a second click.
    focusInputOnCloseRef.current = true
    setOpen(false)
    void onModelChange(value).catch((error: unknown) => onError(errorMessage(error, 'Could not change the model')))
  }
  const chooseEffort = (value: string): void => {
    void onReasoningEffortChange(value).catch((error: unknown) => onError(errorMessage(error, 'Could not change the reasoning effort')))
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger
        ref={triggerRef}
        className="composer-setup-trigger"
        aria-label="Model, reasoning effort, folder, and context usage"
        title={`${trigger.name}${selected?.provider ? '' : ''}${trigger.effort ? ` · ${trigger.effort} effort` : ''}\n${projectPath ?? cwd}${projectPending ? ' (applies after this chat finishes its current work)' : ''}`}
        data-ui="composer.setup"
      >
        <span className="composer-setup-model-wrap">
          {selected && <ProviderMark provider={selected.provider} className="composer-setup-mark" />}
          <span className="composer-setup-model">{trigger.name}</span>
        </span>
        {folder && (
          <span className="composer-setup-folder">
            {folder}{projectPending ? ' (queued)' : ''}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="composer-setup"
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          collisionBoundary={boundary ?? undefined}
          avoidCollisions
          aria-label="Chat setup"
          onCloseAutoFocus={(event) => {
            if (!focusInputOnCloseRef.current) return
            focusInputOnCloseRef.current = false
            const textarea = triggerRef.current?.closest('.composer')?.querySelector<HTMLTextAreaElement>('textarea')
            if (textarea) {
              event.preventDefault()
              textarea.focus()
            }
          }}
        >
          <ModelSection
            sections={providerSections(models, usage, selectedModel)}
            selectedModel={selectedModel}
            disabled={!modelsEnabled}
            onChoose={chooseModel}
          />
          {selected && selected.supportedReasoningEfforts.length > 0 && (
            <EffortSection
              efforts={selected.supportedReasoningEfforts}
              selected={selectedReasoningEffort}
              disabled={!modelsEnabled}
              onChoose={chooseEffort}
            />
          )}
          <FolderSection
            cwd={cwd}
            projectPath={projectPath}
            pending={projectPending}
            recentProjects={recentProjects}
            disabled={busy}
            onChooseProject={onChooseProject}
            onSelectProject={onSelectProject}
            onClearProject={onClearProject}
            onError={onError}
          />
          <ContextSection
            usage={contextUsage}
            provider={selected?.provider ?? provider}
            planUsage={planUsage}
            modelName={trigger.name}
            modelContext={trigger.context}
            modelDescription={trigger.description}
            onCompact={onCompact}
            compactEnabled={compactEnabled}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** The picker's own memory of which models get chosen, kept in this window rather than settings. */
function useModelUsage(): [ModelUsage, (modelId: string) => void] {
  const [usage, setUsage] = useState<ModelUsage>(() => {
    try {
      return parseModelUsage(window.localStorage.getItem(MODEL_USAGE_KEY))
    } catch {
      return {}
    }
  })
  const record = useCallback((modelId: string) => {
    setUsage((previous) => {
      const next = countModelUse(previous, modelId)
      try {
        window.localStorage.setItem(MODEL_USAGE_KEY, JSON.stringify(next))
      } catch {
        // Suppress storage failures: ranking is a convenience, not state the pane depends on.
      }
      return next
    })
  }, [])
  return [usage, record]
}
