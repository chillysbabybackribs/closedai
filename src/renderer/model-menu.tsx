import { useCallback, useState, type JSX } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Check, ChevronDown, ChevronRight, ChevronUp, MoreHorizontal } from 'lucide-react'

import type { ChatModel, ChatProvider } from '../shared/chat.js'
import { ProviderMark } from '../components/ui/provider-mark.js'
import {
  countModelUse, effortLabel, modelTriggerLabel, parseModelUsage, providerSections,
  type ModelUsage, type ProviderSection
} from './model-menu-state.js'

const MODEL_USAGE_KEY = 'closedai.composer.modelUsage'

export type ModelMenuProps = {
  enabled: boolean
  models: ChatModel[]
  selectedModel: string | null
  selectedReasoningEffort: string | null
  onModelChange: (modelId: string) => Promise<void>
  onReasoningEffortChange: (effort: string) => Promise<void>
}

/**
 * One pill for model and effort. The menu opens on the providers — one row each, naming the
 * model in use where that provider owns the selection — and hovering a row opens that
 * provider's models beside it. Four backends' catalogues in one flat list had become a wall of
 * names; this way the first choice is "whose model", which is the one the pane actually turns
 * on. The selected model's effort levels stay on the root, since they belong to the selection
 * rather than to any provider. Rendered in a portal and styled from the chat theme tokens, so
 * it matches the pane instead of the OS select popup.
 */
export function ModelMenu({
  enabled, models, selectedModel, selectedReasoningEffort, onModelChange, onReasoningEffortChange
}: ModelMenuProps): JSX.Element {
  const [usage, recordModelUse] = useModelUsage()
  // Reset on close so every submenu opens short; expanding is a per-visit choice, not a mode.
  const [expanded, setExpanded] = useState<ChatProvider | null>(null)
  const trigger = modelTriggerLabel(models, selectedModel, selectedReasoningEffort)
  const selected = models.find((model) => model.id === selectedModel)
  const efforts = selected?.supportedReasoningEfforts ?? []
  const sections = providerSections(models, usage, selectedModel)
  const chooseModel = (value: string): void => {
    recordModelUse(value)
    void onModelChange(value).catch(() => {})
  }
  return (
    <DropdownMenu.Root modal={false} onOpenChange={(open) => { if (!open) setExpanded(null) }}>
      <DropdownMenu.Trigger
        className="model-menu-trigger"
        disabled={!enabled || models.length === 0}
        aria-label="Model and reasoning effort"
        data-ui="composer.model"
        title={trigger.description || 'Choose a model'}
      >
        {selected && <ProviderMark provider={selected.provider} className="model-menu-trigger-mark" />}
        <span className="model-menu-trigger-name">{trigger.name}</span>
        {trigger.effort && <span className="model-menu-trigger-effort">{trigger.effort}</span>}
        <ChevronDown className="model-menu-trigger-caret" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="model-menu model-menu-providers" align="start" side="top" sideOffset={8} collisionPadding={12}>
          {sections.map((section) => (
            <ProviderSubmenu
              key={section.provider}
              section={section}
              selectedModel={selectedModel}
              expanded={expanded === section.provider}
              onToggleExpanded={() => setExpanded(expanded === section.provider ? null : section.provider)}
              onChoose={chooseModel}
            />
          ))}
          {efforts.length > 0 && (
            <>
              <DropdownMenu.Separator className="model-menu-separator" />
              <DropdownMenu.Label className="model-menu-label">Reasoning effort</DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={selectedReasoningEffort ?? ''}
                onValueChange={(value) => { void onReasoningEffortChange(value).catch(() => {}) }}
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
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type ProviderSubmenuProps = {
  section: ProviderSection
  selectedModel: string | null
  expanded: boolean
  onToggleExpanded: () => void
  onChoose: (modelId: string) => void
}

/** One provider row, with that provider's models in the panel it opens. */
function ProviderSubmenu({ section, selectedModel, expanded, onToggleExpanded, onChoose }: ProviderSubmenuProps): JSX.Element {
  const active = section.all.find((model) => model.id === selectedModel)
  const listed = expanded ? section.all : section.featured
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className="model-menu-item model-menu-provider"
        textValue={section.label}
        data-ui="composer.model-provider"
        data-ui-key={section.provider}
        data-active={active ? 'true' : undefined}
      >
        <ProviderMark provider={section.provider} className="model-menu-label-mark" />
        <span className="model-menu-item-name">{section.label}</span>
        <span className="model-menu-item-detail">
          {active ? active.displayName : `${section.all.length} model${section.all.length === 1 ? '' : 's'}`}
        </span>
        <ChevronRight className="model-menu-provider-caret" aria-hidden="true" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent className="model-menu" sideOffset={6} alignOffset={-5} collisionPadding={12}>
          <DropdownMenu.RadioGroup value={selectedModel ?? ''} onValueChange={onChoose}>
            {listed.map((model) => (
              <DropdownMenu.RadioItem key={model.id} value={model.id} className="model-menu-item" textValue={model.displayName} data-ui="composer.model-item" data-ui-key={model.id}>
                <DropdownMenu.ItemIndicator className="model-menu-indicator"><Check aria-hidden="true" /></DropdownMenu.ItemIndicator>
                <span className="model-menu-item-name">{model.displayName}</span>
                {model.description && <span className="model-menu-item-detail">{model.description}</span>}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          {section.hiddenCount > 0 && (
            <DropdownMenu.Item
              className="model-menu-item model-menu-item-compact model-menu-more"
              textValue={expanded ? 'Show fewer models' : 'Show all models'}
              data-ui="composer.model-more"
              data-ui-key={section.provider}
              onSelect={(event) => { event.preventDefault(); onToggleExpanded() }}
            >
              {expanded
                ? <ChevronUp className="model-menu-more-mark" aria-hidden="true" />
                : <MoreHorizontal className="model-menu-more-mark" aria-hidden="true" />}
              <span className="model-menu-item-name">
                {expanded ? 'Show fewer models' : `Show ${section.hiddenCount} more models`}
              </span>
            </DropdownMenu.Item>
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
