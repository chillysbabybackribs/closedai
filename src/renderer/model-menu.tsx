import { useCallback, useImperativeHandle, useRef, useState, type JSX, type Ref } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'

import type { ChatModel, ChatProvider } from '../shared/chat.js'
import { ProviderMark } from '../components/ui/provider-mark.js'
import { errorMessage } from './error-message.js'
import {
  countModelUse, effortLabel, effortMenuDetail, modelMenuDetail, modelTriggerLabel, parseModelUsage, providerSections,
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
 * and hovering a row opens that provider's catalogue in a separate flyout beside it. Context
 * usage sits under the composer. The chat pane is the collision boundary for both surfaces.
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
            boundary={boundary}
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
  boundary: Element | null
  onChooseModel: (modelId: string) => void
  onChooseEffort: (effort: string) => void
}

/** Provider rows only; each row's catalogue opens in its own submenu flyout. */
function ModelMenuPanel({
  models, usage, selectedModel, selectedReasoningEffort, boundary, onChooseModel, onChooseEffort
}: ModelMenuPanelProps): JSX.Element {
  const sections = providerSections(models, usage, selectedModel)
  const selected = models.find((model) => model.id === selectedModel)
  const [view, setView] = useState<ChatProvider | null>(null)

  return (
    <>
      {sections.map((entry) => (
        <ProviderModelsFlyout
          key={entry.provider}
          section={entry}
          selectedModel={selectedModel}
          selectedReasoningEffort={selectedReasoningEffort}
          efforts={entry.provider === selected?.provider ? selected.supportedReasoningEfforts : []}
          open={view === entry.provider}
          boundary={boundary}
          onActivate={() => setView(entry.provider)}
          onDismiss={() => setView((current) => (current === entry.provider ? null : current))}
          onChooseModel={onChooseModel}
          onChooseEffort={onChooseEffort}
        />
      ))}
    </>
  )
}

function ProviderModelsFlyout({
  section, selectedModel, selectedReasoningEffort, efforts, open, boundary, onActivate, onDismiss,
  onChooseModel, onChooseEffort
}: {
  section: ProviderSection
  selectedModel: string | null
  selectedReasoningEffort: string | null
  efforts: ChatModel['supportedReasoningEfforts']
  open: boolean
  boundary: Element | null
  onActivate: () => void
  onDismiss: () => void
  onChooseModel: (modelId: string) => void
  onChooseEffort: (effort: string) => void
}): JSX.Element {
  const active = section.all.find((model) => model.id === selectedModel)
  return (
    <DropdownMenu.Sub open={open} onOpenChange={(next) => { if (next) onActivate(); else onDismiss() }}>
      <DropdownMenu.SubTrigger
        className="model-menu-item model-menu-provider"
        textValue={section.label}
        data-ui="composer.model-provider"
        data-ui-key={section.provider}
        data-active={active ? 'true' : undefined}
        data-shown={open ? 'true' : undefined}
        onPointerEnter={onActivate}
        onFocus={onActivate}
      >
        <ProviderMark provider={section.provider} className="model-menu-label-mark" />
        <span className="model-menu-item-name">{section.label}</span>
        <ChevronRight className="model-menu-provider-caret" aria-hidden="true" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          className="model-menu model-menu-flyout"
          sideOffset={10}
          collisionPadding={12}
          collisionBoundary={boundary ?? undefined}
          avoidCollisions
          data-provider={section.provider}
        >
          <DropdownMenu.Label className="model-menu-label">
            <ProviderMark provider={section.provider} className="model-menu-label-mark" />
            <span>{section.label}</span>
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={selectedModel ?? ''} onValueChange={onChooseModel}>
            {section.all.map((model) => {
              const detail = modelMenuDetail(model)
              return (
              <DropdownMenu.RadioItem key={model.id} value={model.id} className={`model-menu-item${detail ? '' : ' model-menu-item-single'}`} textValue={detail ? `${model.displayName} ${detail}` : model.displayName} data-ui="composer.model-item" data-ui-key={model.id}>
                <DropdownMenu.ItemIndicator className="model-menu-indicator"><Check aria-hidden="true" /></DropdownMenu.ItemIndicator>
                <span className="model-menu-item-name">{model.displayName}</span>
                {detail && <span className="model-menu-item-detail">{detail}</span>}
              </DropdownMenu.RadioItem>
              )
            })}
          </DropdownMenu.RadioGroup>
          {efforts.length > 0 && (
            <>
              <DropdownMenu.Separator className="model-menu-separator" />
              <DropdownMenu.Label className="model-menu-label">Reasoning effort</DropdownMenu.Label>
              <DropdownMenu.RadioGroup value={selectedReasoningEffort ?? ''} onValueChange={onChooseEffort}>
                {efforts.map((option) => {
                  const detail = effortMenuDetail(option.description)
                  return (
                  <DropdownMenu.RadioItem key={option.reasoningEffort} value={option.reasoningEffort} className={`model-menu-item${detail ? '' : ' model-menu-item-single'}`} textValue={detail ? `${effortLabel(option.reasoningEffort)} ${detail}` : effortLabel(option.reasoningEffort)} data-ui="composer.effort-item" data-ui-key={option.reasoningEffort}>
                    <DropdownMenu.ItemIndicator className="model-menu-indicator"><Check aria-hidden="true" /></DropdownMenu.ItemIndicator>
                    <span className="model-menu-item-name">{effortLabel(option.reasoningEffort)}</span>
                    {detail && <span className="model-menu-item-detail">{detail}</span>}
                  </DropdownMenu.RadioItem>
                  )
                })}
              </DropdownMenu.RadioGroup>
            </>
          )}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
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
