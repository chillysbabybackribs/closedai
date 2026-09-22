import { useCallback, useImperativeHandle, useRef, useState, type JSX, type Ref } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'

import type { ChatModel, ChatProvider } from '../shared/chat.js'
import { ProviderMark } from '../components/ui/provider-mark.js'
import { errorMessage } from './error-message.js'
import {
  countModelUse, effortLabel, modelTriggerLabel, parseModelUsage, providerSections,
  type ModelUsage, type ProviderSection
} from './model-menu-state.js'

const MODEL_USAGE_KEY = 'closedai.composer.modelUsage'

/** Opens the menu from outside its trigger, e.g. the empty pane's "Choose model" hint. */
export type ModelMenuHandle = { open: () => void }

export type ModelMenuProps = {
  ref?: Ref<ModelMenuHandle>
  enabled: boolean
  models: ChatModel[]
  selectedModel: string | null
  selectedReasoningEffort: string | null
  onModelChange: (modelId: string) => Promise<void>
  onReasoningEffortChange: (effort: string) => Promise<void>
  /** Where a failed model or effort change is shown; the composer's alert row. */
  onError?: (message: string) => void
}

/**
 * One pill for model and effort. The menu opens on a short provider list — logo and name only —
 * and hovering a row reveals that provider's full catalogue beside it inside the same popover.
 * Context usage sits under the composer, not on this trigger. The chat pane is the collision
 * boundary so the widened menu cannot reach over the native browser view.
 */
export function ModelMenu({
  ref,
  enabled,
  models,
  selectedModel,
  selectedReasoningEffort,
  onModelChange,
  onReasoningEffortChange,
  onError = () => {}
}: ModelMenuProps): JSX.Element {
  const [usage, recordModelUse] = useModelUsage()
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Resolved when the menu opens: the column the panel must stay inside, never the window.
  const [boundary, setBoundary] = useState<Element | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const setOpen = useCallback((open: boolean): void => {
    setMenuOpen(open)
    if (open) setBoundary(triggerRef.current?.closest('.chat-pane') ?? null)
  }, [])
  const canOpen = enabled && models.length > 0
  useImperativeHandle(ref, () => ({ open: () => { if (canOpen) setOpen(true) } }), [canOpen, setOpen])
  const trigger = modelTriggerLabel(models, selectedModel, selectedReasoningEffort)
  const selected = models.find((model) => model.id === selectedModel)
  const chooseModel = (value: string): void => {
    recordModelUse(value)
    void onModelChange(value).catch((error: unknown) => onError(errorMessage(error, 'Could not change the model')))
  }
  const chooseEffort = (value: string): void => {
    void onReasoningEffortChange(value).catch((error: unknown) => onError(errorMessage(error, 'Could not change the reasoning effort')))
  }
  return (
    <DropdownMenu.Root modal={false} open={menuOpen} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        ref={triggerRef}
        className="model-menu-trigger"
        disabled={!canOpen}
        aria-label="Model and reasoning effort"
        data-ui="composer.model"
      >
        <span className="model-menu-trigger-model">
          {selected && <ProviderMark provider={selected.provider} className="model-menu-trigger-mark" />}
          <span className="model-menu-trigger-name">{trigger.name}</span>
        </span>
        {trigger.effort && <span className="model-menu-trigger-effort">{trigger.effort}</span>}
        <ChevronDown className="model-menu-trigger-caret" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="model-menu"
          align="start"
          side="top"
          sideOffset={8}
          collisionPadding={12}
          collisionBoundary={boundary}
          // The pane is the whole horizontal budget; a submenu is not available to spend more.
          avoidCollisions
        >
          <ModelMenuPanel
            models={models}
            usage={usage}
            selectedModel={selectedModel}
            selectedReasoningEffort={selectedReasoningEffort}
            onChooseModel={chooseModel}
            onChooseEffort={chooseEffort}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type ModelMenuPanelProps = {
  models: ChatModel[]
  usage: ModelUsage
  selectedModel: string | null
  selectedReasoningEffort: string | null
  onChooseModel: (modelId: string) => void
  onChooseEffort: (effort: string) => void
}

/**
 * A narrow provider list opens first; hovering or focusing a row reveals that provider's full
 * catalogue in a second column inside the same popover. Keeping both columns in-panel avoids a
 * Radix flyout that could reach over the native browser view. Effort levels for the selected
 * model sit at the bottom of its provider's catalogue. Context usage lives under the composer.
 */
function ModelMenuPanel({
  models, usage, selectedModel, selectedReasoningEffort, onChooseModel, onChooseEffort
}: ModelMenuPanelProps): JSX.Element {
  const sections = providerSections(models, usage, selectedModel)
  const selected = models.find((model) => model.id === selectedModel)
  const [view, setView] = useState<ChatProvider | null>(null)
  const section = view ? sections.find((entry) => entry.provider === view) : undefined
  const efforts = section && selected?.provider === section.provider ? selected.supportedReasoningEfforts : []

  return (
    <div className={`model-menu-panel model-menu-columns${section ? ' model-menu-columns-open' : ''}`}>
      <div className="model-menu-column model-menu-providers" role="presentation">
        {sections.map((entry) => (
          <ProviderRow key={entry.provider} section={entry} selectedModel={selectedModel}
            shown={entry.provider === section?.provider}
            onShow={() => setView(entry.provider)} />
        ))}
      </div>
      {section && (
        <div className="model-menu-column model-menu-models" role="presentation" data-provider={section.provider}>
          <DropdownMenu.Label className="model-menu-label">
            <ProviderMark provider={section.provider} className="model-menu-label-mark" />
            <span>{section.label}</span>
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={selectedModel ?? ''} onValueChange={onChooseModel}>
            {section.all.map((model) => (
              <DropdownMenu.RadioItem key={model.id} value={model.id} className="model-menu-item" textValue={model.displayName} data-ui="composer.model-item" data-ui-key={model.id}>
                <DropdownMenu.ItemIndicator className="model-menu-indicator"><Check aria-hidden="true" /></DropdownMenu.ItemIndicator>
                <span className="model-menu-item-name">{model.displayName}</span>
                {model.description && <span className="model-menu-item-detail">{model.description}</span>}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          {efforts.length > 0 && (
            <>
              <DropdownMenu.Separator className="model-menu-separator" />
              <DropdownMenu.Label className="model-menu-label">Reasoning effort</DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={selectedReasoningEffort ?? ''}
                onValueChange={onChooseEffort}
              >
                {efforts.map((option) => (
                  <DropdownMenu.RadioItem key={option.reasoningEffort} value={option.reasoningEffort} className="model-menu-item model-menu-item-compact" textValue={option.reasoningEffort} data-ui="composer.effort-item" data-ui-key={option.reasoningEffort}>
                    <DropdownMenu.ItemIndicator className="model-menu-indicator"><Check aria-hidden="true" /></DropdownMenu.ItemIndicator>
                    <span className="model-menu-item-name">{effortLabel(option.reasoningEffort)}</span>
                    {option.description && <span className="model-menu-item-detail">{option.description}</span>}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One provider row: the mark, the name, and the model in use where that provider owns it.
 * Pointer or keyboard focus shows its models; select (click, Enter) does the same and keeps the
 * menu open so the models column is reachable with ArrowRight.
 */
function ProviderRow({ section, selectedModel, shown, onShow }: {
  section: ProviderSection
  selectedModel: string | null
  shown: boolean
  onShow: () => void
}): JSX.Element {
  const active = section.all.find((model) => model.id === selectedModel)
  return (
    <DropdownMenu.Item
      className="model-menu-item model-menu-provider"
      textValue={section.label}
      data-ui="composer.model-provider"
      data-ui-key={section.provider}
      data-active={active ? 'true' : undefined}
      data-shown={shown ? 'true' : undefined}
      onPointerEnter={onShow}
      onFocus={onShow}
      onSelect={(event) => { event.preventDefault(); onShow() }}
    >
      <ProviderMark provider={section.provider} className="model-menu-label-mark" />
      <span className="model-menu-item-name">{section.label}</span>
      <ChevronRight className="model-menu-provider-caret" aria-hidden="true" />
    </DropdownMenu.Item>
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
