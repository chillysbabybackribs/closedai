import { useCallback, useEffect, useImperativeHandle, useRef, useState, type JSX, type Ref } from 'react'
import { ChevronDown } from 'lucide-react'
import { Popover } from 'radix-ui'

import type { ChatContextUsage, ChatModel, ChatPlanUsage, ChatProvider } from '../shared/chat.js'
import { PROVIDER_LABELS } from './chat-state.js'
import { ModelPicker } from './composer-model-picker.js'
import { ContextSection, EffortSection } from './composer-setup-sections.js'
import { errorMessage } from './error-message.js'
import { modelTriggerLabel, parseRecentModels, pushRecentModel, recentModels } from './model-menu-state.js'

const RECENT_MODELS_KEY = 'closedai.composer.recentModels'

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
 * The model trigger below the composer and the fixed-height panel behind it: a context line at
 * the far end, every model sectioned by provider, effort, and Recent nearest the trigger. The
 * chat pane is the collision boundary.
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
  const [recent, reloadRecent] = useRecentModels(selectedModel)
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
      // Other panes add to the same history, so Recent is read fresh on every open.
      reloadRecent()
      // The plan windows are asked for fresh each time the panel opens, mid-turn included.
      void onRefreshPlanUsage()
    }
  }, [onRefreshPlanUsage, reloadRecent])
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
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger
        ref={triggerRef}
        className="composer-footer-model-trigger"
        aria-label="Model, reasoning effort, and context usage"
        title={`${trigger.name}${trigger.effort ? ` · ${trigger.effort} effort` : ''}`}
        data-ui="composer.setup"
      >
        <span className="composer-footer-model-name">{trigger.name}</span>
        <ChevronDown className="composer-footer-chevron" size={12} strokeWidth={2.2} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="composer-setup"
          side="top"
          align="start"
          sideOffset={6}
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
            recent={recentModels(models, recent, selectedModel)}
            disabled={!modelsEnabled}
            onChoose={chooseModel}
            footer={
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * The models this window has used, most recent last, kept in this window rather than settings.
 * Every model the pane lands on counts — picked here, restored with the pane, or set by a tool.
 */
function useRecentModels(selectedModel: string | null): [string[], () => void] {
  const [recent, setRecent] = useState<string[]>(readRecentModels)
  useEffect(() => {
    if (!selectedModel) return
    const next = pushRecentModel(readRecentModels(), selectedModel)
    try {
      window.localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(next))
    } catch {
      // Suppress storage failures: Recent is a convenience, not state the pane depends on.
    }
    setRecent(next)
  }, [selectedModel])
  const reload = useCallback(() => setRecent(readRecentModels()), [])
  return [recent, reload]
}

function readRecentModels(): string[] {
  try {
    return parseRecentModels(window.localStorage.getItem(RECENT_MODELS_KEY))
  } catch {
    return []
  }
}
