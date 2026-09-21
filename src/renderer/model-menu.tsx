import { useCallback, useRef, useState, type JSX } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Check, ChevronDown, ChevronRight, ChevronUp, MoreHorizontal } from 'lucide-react'

import type { ChatContextUsage, ChatModel, ChatPlanUsage, ChatProvider } from '../shared/chat.js'
import { ProviderMark } from '../components/ui/provider-mark.js'
import { ContextMeter } from './context-meter.js'
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
  contextUsage?: ChatContextUsage | null
  provider?: ChatProvider
  planUsage?: ChatPlanUsage | null
  onInspectContext?: () => void
  onRefreshPlanUsage?: () => Promise<void>
  onCompactConversation?: () => Promise<void>
  compactConversationEnabled?: boolean
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
  enabled,
  models,
  selectedModel,
  selectedReasoningEffort,
  contextUsage = null,
  provider = 'codex',
  planUsage = null,
  onInspectContext = () => {},
  onRefreshPlanUsage = async () => {},
  onCompactConversation,
  compactConversationEnabled = false,
  onModelChange,
  onReasoningEffortChange
}: ModelMenuProps): JSX.Element {
  const [usage, recordModelUse] = useModelUsage()
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Resolved when the menu opens: the column the panel must stay inside, never the window.
  const [boundary, setBoundary] = useState<Element | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const trigger = modelTriggerLabel(models, selectedModel, selectedReasoningEffort)
  const selected = models.find((model) => model.id === selectedModel)
  const chooseModel = (value: string): void => {
    recordModelUse(value)
    void onModelChange(value).catch(() => {})
  }
  return (
    <DropdownMenu.Root
      modal={false}
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open)
        if (open) setBoundary(triggerRef.current?.closest('.chat-pane') ?? null)
      }}
    >
      <DropdownMenu.Trigger
        ref={triggerRef}
        className="model-menu-trigger"
        disabled={!enabled || models.length === 0}
        aria-label="Model and reasoning effort"
        data-ui="composer.model"
      >
        <ContextMeter
          usage={contextUsage}
          provider={selected?.provider ?? provider}
          planUsage={planUsage}
          modelName={trigger.name}
          modelContext={trigger.context}
          modelDescription={trigger.description}
          onInspect={onInspectContext}
          onRefreshPlanUsage={onRefreshPlanUsage}
          onCompact={onCompactConversation}
          compactEnabled={compactConversationEnabled}
          disabled={menuOpen}
        >
          <span className="model-menu-trigger-model">
            {selected && <ProviderMark provider={selected.provider} className="model-menu-trigger-mark" />}
            <span className="model-menu-trigger-name">{trigger.name}</span>
          </span>
        </ContextMeter>
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
 * Two columns inside the one popover: providers on the left, the hovered provider's models on
 * the right, plus the selected model's effort levels under the providers. Hovering or focusing
 * a provider row switches the right column; nothing needs a click before a model is visible.
 * A Radix Sub would fly out beside the panel and can reach over the native browser view, so
 * the models column is ordinary panel content that the collision boundary already contains.
 * Mounted with the open menu, so the hovered provider and its expanded state reset on close.
 */
function ModelMenuPanel({
  models, usage, selectedModel, selectedReasoningEffort, onChooseModel, onReasoningEffortChange
}: ModelMenuPanelProps): JSX.Element {
  const sections = providerSections(models, usage, selectedModel)
  const selected = models.find((model) => model.id === selectedModel)
  const [view, setView] = useState<ChatProvider | null>(selected?.provider ?? sections[0]?.provider ?? null)
  const [expanded, setExpanded] = useState(false)
  const section = sections.find((entry) => entry.provider === view) ?? sections[0]
  const efforts = selected?.supportedReasoningEfforts ?? []
  const show = (provider: ChatProvider): void => {
    if (provider === view) return
    setExpanded(false)
    setView(provider)
  }
  const listed = section ? (expanded ? section.all : section.featured) : []

  return (
    <div className="model-menu-panel model-menu-columns">
      <div className="model-menu-column model-menu-providers" role="presentation">
        {sections.map((entry) => (
          <ProviderRow key={entry.provider} section={entry} selectedModel={selectedModel}
            shown={entry.provider === section?.provider} onShow={() => show(entry.provider)} />
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
      {section && (
        <div className="model-menu-column model-menu-models" role="presentation" data-provider={section.provider}>
          <DropdownMenu.Label className="model-menu-label">
            <ProviderMark provider={section.provider} className="model-menu-label-mark" />
            <span>{section.label}</span>
            <span className="model-menu-label-count">{modelCountLabel(section.all.length)}</span>
          </DropdownMenu.Label>
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
