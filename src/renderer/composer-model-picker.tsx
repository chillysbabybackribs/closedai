import { useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'

import { Command, CommandItem, CommandList } from '../components/ui/command.js'
import { Popover, PopoverAnchor, PopoverContent } from '../components/ui/popover.js'
import { ProviderMark } from '../components/ui/provider-mark.js'
import { cn } from '../lib/utils.js'
import type { ChatModel, ChatProvider } from '../shared/chat.js'
import { modelBlurb, modelContextLabel, modelFlyoutPlacement, modelGroups, type ModelFlyoutPlacement, type ModelGroup } from './model-menu-state.js'

/**
 * The model picker in two steps: the panel lists only the providers, one row each, and choosing
 * one opens that provider's models in a flyout beside the panel. The flyout picks the side of the
 * panel that has room in the chat pane and grows the way the panel opened, up above the trigger
 * or down below it. Effort belongs to the selected model, so it sits under the models of the
 * provider that owns the selection.
 */
export function ModelPicker({
  models,
  selectedModel,
  provider,
  disabled,
  boundary,
  effort,
  onChoose
}: {
  models: ChatModel[]
  selectedModel: string | null
  /** The pane's provider; models of any other one start a new thread when chosen. */
  provider: ChatProvider
  disabled: boolean
  /** The box both the panel and the flyout stay inside; null means the viewport. */
  boundary: Element | null
  /** Rendered under the models of the provider that owns the selection; keeps its own keys. */
  effort?: ReactNode
  onChoose: (modelId: string) => void
}): JSX.Element {
  const groups = modelGroups(models)
  const current = models.find((model) => model.id === selectedModel) ?? null
  const activeProvider = current?.provider ?? provider
  const [highlighted, setHighlighted] = useState<string>(() => activeProvider)
  const [open, setOpen] = useState<{ provider: ChatProvider; placement: ModelFlyoutPlacement } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<ChatProvider, HTMLDivElement>())
  const anchor = useRef<HTMLDivElement | null>(null)
  // Set when a model is chosen: the whole panel is closing, so focus must not return to the rows.
  const choosingRef = useRef(false)

  if (groups.length === 0) {
    return <p className="composer-setup-note px-3 py-3">No models are available yet.</p>
  }

  const openGroup = open ? groups.find((group) => group.provider === open.provider) ?? null : null

  const openProvider = (next: ChatProvider): void => {
    const row = rows.current.get(next)
    const panel = listRef.current?.closest<HTMLElement>('[data-slot="popover-content"]')
    if (!row || !panel) return
    const edge = boundary?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth, width: window.innerWidth }
    anchor.current = row
    setHighlighted(next)
    setOpen({
      provider: next,
      placement: modelFlyoutPlacement(panel.getBoundingClientRect(), row.getBoundingClientRect(), edge, panel.getAttribute('data-side'))
    })
  }
  const choose = (model: ChatModel): void => {
    choosingRef.current = true
    setOpen(null)
    onChoose(model.id)
  }
  const onRowsKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    openProvider(highlighted as ChatProvider)
  }

  return (
    <>
      <Command
        ref={listRef}
        value={highlighted}
        onValueChange={setHighlighted}
        onKeyDown={onRowsKeyDown}
        loop
        label="Provider"
        className="h-auto shrink-0 rounded-none bg-transparent outline-none"
      >
        <CommandList className="max-h-none p-1">
          {groups.map((group) => (
            <CommandItem
              key={group.provider}
              ref={(element: HTMLDivElement | null) => { if (element) rows.current.set(group.provider, element); else rows.current.delete(group.provider) }}
              value={group.provider}
              onSelect={() => openProvider(group.provider)}
              data-ui="composer.model-provider"
              data-ui-key={group.provider}
              data-state={open?.provider === group.provider ? 'open' : 'closed'}
              aria-haspopup="dialog"
              aria-expanded={open?.provider === group.provider}
              className="h-9 gap-2.5 px-2.5 text-[13px] data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
            >
              <ProviderMark provider={group.provider} className="size-4 shrink-0" />
              <span className="shrink-0 font-medium">{group.label}</span>
              <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                {group.provider === activeProvider ? current?.displayName ?? '' : ''}
              </span>
              <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
            </CommandItem>
          ))}
        </CommandList>
      </Command>
      <Popover open={openGroup !== null} onOpenChange={(next) => { if (!next) setOpen(null) }} modal={false}>
        <PopoverAnchor virtualRef={anchor as React.RefObject<HTMLDivElement>} />
        {openGroup && open && (
          <PopoverContent
            className="composer-model-flyout"
            style={{ width: open.placement.width }}
            side={open.placement.side}
            align={open.placement.align}
            sideOffset={open.placement.sideOffset}
            collisionPadding={12}
            collisionBoundary={boundary ?? undefined}
            avoidCollisions
            aria-label={`${openGroup.label} models`}
            onOpenAutoFocus={(event) => {
              const root = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[cmdk-root]')
              if (!root) return
              event.preventDefault()
              root.focus()
              root.querySelector('[data-checked]')?.scrollIntoView({ block: 'nearest' })
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (choosingRef.current) { choosingRef.current = false; return }
              if (listRef.current?.isConnected) listRef.current.focus()
            }}
            // A press on a provider row is that row's own choice, not a dismissal of the flyout.
            onInteractOutside={(event) => {
              if (listRef.current?.contains(event.target as Node)) event.preventDefault()
            }}
          >
            <ModelFlyoutBody
              group={openGroup}
              selectedModel={selectedModel}
              newThread={openGroup.provider !== activeProvider}
              disabled={disabled}
              effort={openGroup.provider === activeProvider ? effort : undefined}
              onBack={() => setOpen(null)}
              onChoose={choose}
            />
          </PopoverContent>
        )}
      </Popover>
    </>
  )
}

/** One provider's models: a heading, the rows, and effort when this provider owns the selection. */
export function ModelFlyoutBody({ group, selectedModel, newThread, disabled, effort, onBack, onChoose }: {
  group: ModelGroup
  selectedModel: string | null
  newThread: boolean
  disabled: boolean
  effort?: ReactNode
  onBack: () => void
  onChoose: (model: ChatModel) => void
}): JSX.Element {
  const landing = group.models.find((model) => model.id === selectedModel) ?? group.models[0]
  const [highlighted, setHighlighted] = useState(landing?.id ?? '')
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1 text-xs text-muted-foreground">
        <ProviderMark provider={group.provider} className="size-3 shrink-0" />
        {group.label}
        {newThread && <span className="ml-auto opacity-70">Starts a new thread</span>}
      </div>
      <Command
        value={highlighted}
        onValueChange={setHighlighted}
        onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); onBack() } }}
        loop
        label={`${group.label} models`}
        className="min-h-0 flex-1 rounded-none bg-transparent outline-none"
      >
        <CommandList className="max-h-none min-h-0 flex-1 px-1 pb-1">
          {group.models.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              checked={model.id === selectedModel}
              disabled={disabled && model.id !== selectedModel}
              onSelect={() => { if (model.id === selectedModel) onBack(); else onChoose(model) }}
            />
          ))}
        </CommandList>
      </Command>
      {/* Effort's own controls take Enter and arrows; cmdk would otherwise choose the
          highlighted model on Enter and move its highlight on arrows. */}
      {effort && <div className="shrink-0" onKeyDown={(event) => event.stopPropagation()}>{effort}</div>}
    </>
  )
}

function ModelRow({ model, checked, disabled, onSelect }: {
  model: ChatModel
  checked: boolean
  disabled: boolean
  onSelect: () => void
}): JSX.Element {
  const context = modelContextLabel(model.contextWindow)
  return (
    <CommandItem
      value={model.id}
      disabled={disabled}
      onSelect={onSelect}
      data-ui="composer.model-item"
      data-ui-key={model.id}
      data-checked={checked || undefined}
      title={modelBlurb(model) ?? undefined}
      className="h-8 gap-2 text-[13px]"
    >
      <Check className={cn('size-3.5', !checked && 'invisible')} aria-hidden="true" />
      <span className={cn('truncate', checked && 'font-medium')}>{model.displayName}</span>
      {context && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{context}</span>}
    </CommandItem>
  )
}
