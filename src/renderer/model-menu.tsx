import { useCallback, useState, type JSX } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Check, ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'

import type { ChatModel } from '../shared/chat.js'
import { ProviderMark } from '../components/ui/provider-mark.js'
import {
  countModelUse, effortLabel, modelSections, modelTriggerLabel, parseModelUsage, type ModelUsage
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
 * One pill for model and effort. The menu opens on each provider's top few models, grouped
 * under that provider's heading, with the rest of the catalogue one row away — the same row
 * folds it back — and the selected model's effort levels below. Rendered in a portal and styled
 * from the chat theme tokens, so it matches the pane instead of the OS select popup.
 */
export function ModelMenu({
  enabled, models, selectedModel, selectedReasoningEffort, onModelChange, onReasoningEffortChange
}: ModelMenuProps): JSX.Element {
  const [usage, recordModelUse] = useModelUsage()
  // Reset on close so the menu always opens short; expanding is a per-visit choice, not a mode.
  const [showAll, setShowAll] = useState(false)
  const trigger = modelTriggerLabel(models, selectedModel, selectedReasoningEffort)
  const selected = models.find((model) => model.id === selectedModel)
  const efforts = selected?.supportedReasoningEfforts ?? []
  const sections = modelSections(models, usage, selectedModel)
  const groups = showAll ? sections.all : sections.featured
  return (
    <DropdownMenu.Root modal={false} onOpenChange={(open) => { if (!open) setShowAll(false) }}>
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
        <DropdownMenu.Content className="model-menu" align="start" side="top" sideOffset={8} collisionPadding={12}>
          <DropdownMenu.RadioGroup
            value={selectedModel ?? ''}
            onValueChange={(value) => { recordModelUse(value); void onModelChange(value).catch(() => {}) }}
          >
            {groups.map((group) => (
              <DropdownMenu.Group key={group.provider} className="model-menu-group">
                <DropdownMenu.Label className="model-menu-label">
                  <ProviderMark provider={group.provider} className="model-menu-label-mark" />
                  {group.label}
                </DropdownMenu.Label>
                {group.models.map((model) => (
                  <DropdownMenu.RadioItem key={model.id} value={model.id} className="model-menu-item" textValue={model.displayName} data-ui="composer.model-item" data-ui-key={model.id}>
                    <DropdownMenu.ItemIndicator className="model-menu-indicator"><Check aria-hidden="true" /></DropdownMenu.ItemIndicator>
                    <span className="model-menu-item-name">{model.displayName}</span>
                    {model.description && <span className="model-menu-item-detail">{model.description}</span>}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.Group>
            ))}
          </DropdownMenu.RadioGroup>
          {sections.hiddenCount > 0 && (
            <DropdownMenu.Item
              className="model-menu-item model-menu-item-compact model-menu-more"
              textValue={showAll ? 'Show fewer models' : 'Show all models'}
              data-ui="composer.model-more"
              onSelect={(event) => { event.preventDefault(); setShowAll(!showAll) }}
            >
              {showAll
                ? <ChevronUp className="model-menu-more-mark" aria-hidden="true" />
                : <MoreHorizontal className="model-menu-more-mark" aria-hidden="true" />}
              <span className="model-menu-item-name">
                {showAll ? 'Show fewer models' : `Show ${sections.hiddenCount} more models`}
              </span>
            </DropdownMenu.Item>
          )}
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
