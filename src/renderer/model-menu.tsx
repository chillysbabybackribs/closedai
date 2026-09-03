import type { JSX } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'

import type { ChatModel } from '../shared/chat.js'
import { ProviderMark } from '../components/ui/provider-mark.js'
import { effortLabel, modelGroups, modelTriggerLabel } from './model-menu-state.js'

export type ModelMenuProps = {
  enabled: boolean
  models: ChatModel[]
  selectedModel: string | null
  selectedReasoningEffort: string | null
  onModelChange: (modelId: string) => Promise<void>
  onReasoningEffortChange: (effort: string) => Promise<void>
}

/**
 * One pill for model and effort. The menu lists every provider's models under its own heading
 * and, below them, the effort levels the selected model supports. Rendered in a portal and
 * styled from the chat theme tokens, so it matches the pane instead of the OS select popup.
 */
export function ModelMenu({
  enabled, models, selectedModel, selectedReasoningEffort, onModelChange, onReasoningEffortChange
}: ModelMenuProps): JSX.Element {
  const trigger = modelTriggerLabel(models, selectedModel, selectedReasoningEffort)
  const selected = models.find((model) => model.id === selectedModel)
  const efforts = selected?.supportedReasoningEfforts ?? []
  return (
    <DropdownMenu.Root modal={false}>
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
            onValueChange={(value) => { void onModelChange(value).catch(() => {}) }}
          >
            {modelGroups(models).map((group) => (
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
