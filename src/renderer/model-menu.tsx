import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp, MoreHorizontal } from 'lucide-react'

import type { ChatModel, ChatProvider } from '../shared/chat.js'
import { ProviderMark } from '../components/ui/provider-mark.js'
import {
  countModelUse, effortLabel, modelContextLabel, modelTriggerLabel, parseModelUsage, providerSections,
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
 * model in use where that provider owns the selection — and choosing a row replaces the panel
 * with that provider's models. Four backends' catalogues in one flat list had become a wall of
 * names; this way the first choice is "whose model", which is the one the pane actually turns
 * on. The selected model's effort levels stay on the root, since they belong to the selection
 * rather than to any provider.
 *
 * The provider's models used to fly out beside the root panel, which pushed the menu across the
 * chat/browser divider: Electron paints the browser's WebContentsView above the renderer, so
 * anything reaching over it costs a capture-and-freeze of the live page. One panel that swaps
 * its contents keeps the whole picker inside the chat column, and the chat pane is passed as the
 * collision boundary so Radix can neither widen nor shift it over the browser.
 */
export function ModelMenu({
  enabled, models, selectedModel, selectedReasoningEffort, onModelChange, onReasoningEffortChange
}: ModelMenuProps): JSX.Element {
  const [usage, recordModelUse] = useModelUsage()
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Resolved when the menu opens: the column the panel must stay inside, never the window.
  const [boundary, setBoundary] = useState<Element | null>(null)
  const trigger = modelTriggerLabel(models, selectedModel, selectedReasoningEffort)
  const selected = models.find((model) => model.id === selectedModel)
  const chooseModel = (value: string): void => {
    recordModelUse(value)
    void onModelChange(value).catch(() => {})
  }
  return (
    <DropdownMenu.Root
      modal={false}
      onOpenChange={(open) => { if (open) setBoundary(triggerRef.current?.closest('.chat-pane') ?? null) }}
    >
      <DropdownMenu.Trigger
        ref={triggerRef}
        className="model-menu-trigger"
        disabled={!enabled || models.length === 0}
        aria-label="Model and reasoning effort"
        data-ui="composer.model"
        title={trigger.description || 'Choose a model'}
      >
        {selected && <ProviderMark provider={selected.provider} className="model-menu-trigger-mark" />}
        <span className="model-menu-trigger-name">{trigger.name}</span>
        {trigger.context && <span className="model-menu-trigger-context">{trigger.context}</span>}
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
            onReasoningEffortChange={onReasoningEffortChange}
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
  onReasoningEffortChange: (effort: string) => Promise<void>
}

/**
 * The panel's contents: providers, or one provider's models. Mounted with the open menu, so both
 * the drilled-into provider and its expanded state reset on close — expanding is a per-visit
 * choice, not a mode.
 */
function ModelMenuPanel({
  models, usage, selectedModel, selectedReasoningEffort, onChooseModel, onReasoningEffortChange
}: ModelMenuPanelProps): JSX.Element {
  const [view, setView] = useState<ChatProvider | null>(null)
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const sections = providerSections(models, usage, selectedModel)
  const section = sections.find((entry) => entry.provider === view)
  const selected = models.find((model) => model.id === selectedModel)
  const efforts = selected?.supportedReasoningEfforts ?? []
  const open = (provider: ChatProvider): void => { setExpanded(false); setView(provider) }

  // Swapping the contents unmounts the focused row, so hand focus to the panel the user is now
  // looking at: the first model on the way in, and the provider row they came from on the way back.
  useFocusOnViewChange(rootRef, view)

  if (section) {
    const listed = expanded ? section.all : section.featured
    return (
      <div
        ref={rootRef}
        className="model-menu-panel"
        // The flyout it replaced closed on ArrowLeft; the drill-down keeps that key meaning "back".
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft') return
          event.preventDefault()
          setView(null)
        }}
      >
        <DropdownMenu.Item
          className="model-menu-item model-menu-item-compact model-menu-back"
          textValue={`Back to providers from ${section.label}`}
          data-ui="composer.model-back"
          data-ui-key={section.provider}
          onSelect={(event) => { event.preventDefault(); setView(null) }}
        >
          <ArrowLeft className="model-menu-back-mark" aria-hidden="true" />
          <ProviderMark provider={section.provider} className="model-menu-label-mark" />
          <span className="model-menu-item-name">{section.label}</span>
          <span className="model-menu-item-detail">{modelCountLabel(section.all.length)}</span>
        </DropdownMenu.Item>
        <DropdownMenu.RadioGroup value={selectedModel ?? ''} onValueChange={onChooseModel}>
          {listed.map((model) => (
            <DropdownMenu.RadioItem key={model.id} value={model.id} className="model-menu-item" textValue={model.displayName} data-ui="composer.model-item" data-ui-key={model.id}>
              <DropdownMenu.ItemIndicator className="model-menu-indicator"><Check aria-hidden="true" /></DropdownMenu.ItemIndicator>
              <span className="model-menu-item-heading">
                <span className="model-menu-item-name">{model.displayName}</span>
                {modelContextLabel(model.contextWindow) && (
                  <span className="model-menu-item-context">{modelContextLabel(model.contextWindow)}</span>
                )}
              </span>
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
            onSelect={(event) => { event.preventDefault(); setExpanded(!expanded) }}
          >
            {expanded
              ? <ChevronUp className="model-menu-more-mark" aria-hidden="true" />
              : <MoreHorizontal className="model-menu-more-mark" aria-hidden="true" />}
            <span className="model-menu-item-name">
              {expanded ? 'Show fewer models' : `Show ${section.hiddenCount} more models`}
            </span>
          </DropdownMenu.Item>
        )}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="model-menu-panel model-menu-providers">
      {sections.map((entry) => (
        <ProviderRow key={entry.provider} section={entry} selectedModel={selectedModel} onOpen={() => open(entry.provider)} />
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
    </div>
  )
}

/** One provider row: the mark, the name, and the model in use where that provider owns it. */
function ProviderRow({ section, selectedModel, onOpen }: {
  section: ProviderSection
  selectedModel: string | null
  onOpen: () => void
}): JSX.Element {
  const active = section.all.find((model) => model.id === selectedModel)
  return (
    <DropdownMenu.Item
      className="model-menu-item model-menu-provider"
      textValue={section.label}
      data-ui="composer.model-provider"
      data-ui-key={section.provider}
      data-active={active ? 'true' : undefined}
      onSelect={(event) => { event.preventDefault(); onOpen() }}
    >
      <ProviderMark provider={section.provider} className="model-menu-label-mark" />
      <span className="model-menu-item-name">{section.label}</span>
      <span className="model-menu-item-detail">
        {active ? active.displayName : modelCountLabel(section.all.length)}
      </span>
      <ChevronRight className="model-menu-provider-caret" aria-hidden="true" />
    </DropdownMenu.Item>
  )
}

function modelCountLabel(count: number): string {
  return `${count} model${count === 1 ? '' : 's'}`
}

/** Move focus into the panel that replaced the one holding the focused row. */
function useFocusOnViewChange(rootRef: React.RefObject<HTMLDivElement | null>, view: ChatProvider | null): void {
  const previous = useRef<ChatProvider | null>(null)
  useEffect(() => {
    const from = previous.current
    previous.current = view
    if (from === view) return
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current
      if (!root) return
      // Back to the providers: land on the row just left, not at the top of the list.
      const target = view === null && from
        ? root.querySelector<HTMLElement>(`[data-ui="composer.model-provider"][data-ui-key="${from}"]`)
        : root.querySelector<HTMLElement>('[data-ui="composer.model-item"], [data-ui="composer.model-back"]')
      target?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [rootRef, view])
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
