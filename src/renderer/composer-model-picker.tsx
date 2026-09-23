import { useState, type JSX, type ReactNode } from 'react'
import { Check } from 'lucide-react'

import { Command, CommandGroup, CommandItem, CommandList } from '../components/ui/command.js'
import { ProviderMark } from '../components/ui/provider-mark.js'
import { cn } from '../lib/utils.js'
import type { ChatModel, ChatProvider } from '../shared/chat.js'
import { PROVIDER_LABELS } from './chat-state.js'
import { modelContextLabel, modelGroups } from './model-menu-state.js'

/** A section row and its Recent twin are distinct cmdk items, so the list can hold a model twice. */
const itemValue = (group: string, model: ChatModel): string => `${group}\u0000${model.id}`

/**
 * The model list: every model, sectioned by provider under pinned headings, scrolling above a
 * fixed footer (effort) and the Recent block. Recent is last so the models a user flips between
 * sit right above the trigger. No search and no folding: the popover's fixed height is the only
 * bound, and it opens scrolled to the section that holds the current model.
 */
export function ModelPicker({
  models,
  selectedModel,
  provider,
  recent,
  disabled,
  footer,
  onChoose
}: {
  models: ChatModel[]
  selectedModel: string | null
  /** The pane's provider; sections for any other one start a new thread when chosen. */
  provider: ChatProvider
  /** Most recent last, current model already excluded. */
  recent: ChatModel[]
  disabled: boolean
  /** Rendered between the scrolling list and Recent; keeps its own keyboard handling. */
  footer?: ReactNode
  onChoose: (modelId: string) => void
}): JSX.Element {
  const groups = modelGroups(models)
  const current = models.find((model) => model.id === selectedModel) ?? null
  const landing = current ?? groups[0]?.models[0] ?? null
  const [highlighted, setHighlighted] = useState(() => (landing ? itemValue(landing.provider, landing) : ''))

  if (groups.length === 0) {
    return <p className="composer-setup-note px-3 py-3">No models are available yet.</p>
  }

  const activeProvider = current?.provider ?? provider
  const choose = (model: ChatModel): void => { if (model.id !== selectedModel) onChoose(model.id) }

  return (
    <Command
      value={highlighted}
      onValueChange={setHighlighted}
      loop
      label="Model"
      className="min-h-0 flex-1 rounded-none bg-transparent outline-none"
    >
      <CommandList className="max-h-none min-h-0 flex-1 pb-1">
        {groups.map((group) => (
          <CommandGroup
            key={group.provider}
            data-provider={group.provider}
            heading={
              <span className="flex items-center gap-2">
                <ProviderMark provider={group.provider} className="size-3 shrink-0" />
                {group.label}
                {group.provider !== activeProvider && <span className="ml-auto font-normal opacity-60">new thread</span>}
              </span>
            }
            className="overflow-visible px-1 py-0 [&_[cmdk-group-heading]]:sticky [&_[cmdk-group-heading]]:top-0 [&_[cmdk-group-heading]]:z-10 [&_[cmdk-group-heading]]:bg-popover [&_[cmdk-group-heading]]:pt-2.5"
          >
            {group.models.map((model) => (
              <ModelRow
                key={model.id}
                control="composer.model-item"
                model={model}
                value={itemValue(group.provider, model)}
                checked={model.id === selectedModel}
                disabled={disabled && model.id !== selectedModel}
                onSelect={() => choose(model)}
              />
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      {/* The footer's own controls take Enter and arrows; cmdk would otherwise choose the
          highlighted model on Enter and move its highlight on arrows. */}
      {footer && <div onKeyDown={(event) => event.stopPropagation()}>{footer}</div>}
      {recent.length > 0 && (
        <CommandGroup heading="Recent" className="shrink-0 border-t border-border px-1 pt-0 pb-1 [&_[cmdk-group-heading]]:pt-2.5">
          {recent.map((model) => (
            <ModelRow
              key={model.id}
              control="composer.model-recent"
              model={model}
              value={itemValue('recent', model)}
              checked={false}
              disabled={disabled}
              lane
              onSelect={() => choose(model)}
            />
          ))}
        </CommandGroup>
      )}
    </Command>
  )
}

function ModelRow({ control, model, value, checked, disabled, lane = false, onSelect }: {
  control: 'composer.model-item' | 'composer.model-recent'
  model: ChatModel
  value: string
  checked: boolean
  disabled: boolean
  /** Recent rows mix providers, so they name theirs. */
  lane?: boolean
  onSelect: () => void
}): JSX.Element {
  const context = modelContextLabel(model.contextWindow)
  const title = [model.description.trim(), context ? `${context} context` : ''].filter(Boolean).join(' · ')
  return (
    <CommandItem
      value={value}
      disabled={disabled}
      onSelect={onSelect}
      data-ui={control}
      data-ui-key={model.id}
      data-checked={checked || undefined}
      title={title || undefined}
      className="h-8 gap-2 text-[13px]"
    >
      {lane
        ? <ProviderMark provider={model.provider} className="size-3.5 shrink-0" />
        : <Check className={cn('size-3.5', !checked && 'invisible')} aria-hidden="true" />}
      <span className={cn('truncate', checked && 'font-medium')}>{model.displayName}</span>
      {lane && <span className="truncate text-xs text-muted-foreground">{PROVIDER_LABELS[model.provider]}</span>}
      {context && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{context}</span>}
    </CommandItem>
  )
}
