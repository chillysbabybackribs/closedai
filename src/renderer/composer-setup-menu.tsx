import { useCallback, useImperativeHandle, useRef, useState, type JSX, type Ref } from 'react'
import { ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js'

import type { ChatContextUsage, ChatModel, ChatPlanUsage, ChatProvider } from '../shared/chat.js'
import { PROVIDER_LABELS } from './chat-state.js'
import { ModelPicker } from './composer-model-picker.js'
import { ContextSection, EffortSection } from './composer-setup-sections.js'
import { errorMessage } from './error-message.js'
import { modelTriggerLabel } from './model-menu-state.js'
import { CAPSULE_PANEL_OFFSET, composerPanelBoundary } from './composer-layout.js'

/** Opens the panel from outside its trigger, e.g. the empty pane's "Choose model" hint. */
export type ComposerSetupHandle = { open: () => void }

export type ComposerSetupMenuProps = {
  ref?: Ref<ComposerSetupHandle>
  /** Model and effort can change; false while a turn runs or the provider is unavailable. */
  modelsEnabled: boolean
  /** A turn is running: the locked controls say why. */
  running?: boolean
  models: ChatModel[]
  selectedModel: string | null
  selectedReasoningEffort: string | null
  onModelChange: (modelId: string) => Promise<void>
  onReasoningEffortChange: (effort: string) => Promise<void>
  /** Where a failed change is shown: the composer's alert row. */
  onError: (message: string) => void
  contextUsage: ChatContextUsage | null
  provider: ChatProvider
  planUsage: ChatPlanUsage | null
  onRefreshPlanUsage: () => Promise<void>
  onCompact?: () => Promise<void>
  compactEnabled: boolean
}

/**
 * The model trigger below the composer and the panel behind it: a context line, then one row per
 * provider, each opening its models (and, for the selected model's provider, effort) in a flyout.
 * The chat pane is the collision boundary for both.
 */
export function ComposerSetupMenu({
  ref,
  modelsEnabled,
  running = false,
  models,
  selectedModel,
  selectedReasoningEffort,
  onModelChange,
  onReasoningEffortChange,
  onError,
  contextUsage,
  provider,
  planUsage,
  onRefreshPlanUsage,
  onCompact,
  compactEnabled
}: ComposerSetupMenuProps): JSX.Element {
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
      setBoundary(composerPanelBoundary(triggerRef.current))
      // The plan windows are asked for fresh each time the panel opens, mid-turn included.
      void onRefreshPlanUsage()
    }
  }, [onRefreshPlanUsage])
  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), [setOpen])

  const trigger = modelTriggerLabel(models, selectedModel, selectedReasoningEffort)
  const selected = models.find((model) => model.id === selectedModel)
  const chooseModel = (value: string): void => {
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
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger
        ref={triggerRef}
        className="composer-chip-model-trigger"
        aria-label="Model, reasoning effort, and context usage"
        title={`${trigger.name}${trigger.effort ? ` · ${trigger.effort} effort` : ''}`}
        data-ui="composer.setup"
      >
        <span className="composer-chip-model-name">{trigger.name}</span>
        <ChevronDown className="composer-chip-chevron" size={12} strokeWidth={2.2} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        className="composer-setup"
        side="top"
        align="start"
        sideOffset={CAPSULE_PANEL_OFFSET}
        collisionPadding={12}
        collisionBoundary={boundary ?? undefined}
        avoidCollisions
        aria-label="Chat setup"
        onOpenAutoFocus={(event) => {
          // Focus the model list, not the context line above it, so arrows and Enter pick a model.
          const list = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[cmdk-root]')
          if (!list) return
          event.preventDefault()
          list.focus()
        }}
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
        <ModelPicker
            models={models}
            selectedModel={selectedModel}
            provider={provider}
            disabled={!modelsEnabled}
            boundary={boundary}
            onChoose={chooseModel}
            effort={
              <EffortSection
                efforts={selected?.supportedReasoningEfforts ?? []}
                selected={selectedReasoningEffort}
                disabled={!modelsEnabled}
                note={running ? 'Locked while this turn runs' : null}
                providerLabel={PROVIDER_LABELS[selected?.provider ?? provider]}
                onChoose={chooseEffort}
              />
            }
        />
      </PopoverContent>
    </Popover>
  )
}
