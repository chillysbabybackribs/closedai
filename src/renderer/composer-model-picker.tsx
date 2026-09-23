import { useEffect, useMemo, useState, type JSX } from 'react'
import { Check } from 'lucide-react'

import { ProviderMark } from '../components/ui/provider-mark.js'
import type { ChatModel, ChatProvider } from '../shared/chat.js'
import { modelContextLabel, type ProviderSection } from './model-menu-state.js'

function providerForModel(sections: ProviderSection[], modelId: string | null): ChatProvider | null {
  if (!modelId) return null
  return sections.find((section) => section.all.some((model) => model.id === modelId))?.provider ?? null
}

function matchesQuery(model: ChatModel, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return model.displayName.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle)
}

/**
 * One provider at a time: tabs across the top, a compact scrollable list beneath, optional filter
 * when the catalogue is long. Descriptions stay in the row title, not in the list.
 */
export function ModelSection({
  sections,
  selectedModel,
  disabled,
  onChoose
}: {
  sections: ProviderSection[]
  selectedModel: string | null
  disabled: boolean
  onChoose: (modelId: string) => void
}): JSX.Element {
  const selectedProvider = providerForModel(sections, selectedModel)
  const [activeProvider, setActiveProvider] = useState<ChatProvider | null>(
    () => selectedProvider ?? sections[0]?.provider ?? null
  )
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (selectedProvider) setActiveProvider(selectedProvider)
  }, [selectedProvider])

  useEffect(() => {
    setExpanded(false)
    setQuery('')
  }, [activeProvider])

  const section = sections.find((entry) => entry.provider === activeProvider)
  const listed = useMemo(() => {
    if (!section) return []
    const base = expanded || section.hiddenCount === 0 ? section.all : section.featured
    return base.filter((model) => matchesQuery(model, query))
  }, [expanded, query, section])

  if (sections.length === 0) {
    return (
      <section className="composer-setup-section composer-model-section" aria-label="Model">
        <p className="composer-setup-note">No models are available yet.</p>
      </section>
    )
  }

  const showSearch = (section?.all.length ?? 0) > 5
  const hiddenCount = section && !expanded && section.hiddenCount > 0 ? section.hiddenCount : 0

  return (
    <section className="composer-setup-section composer-model-section" aria-label="Model">
      <div className="composer-model-tabs" role="tablist" aria-label="Model providers">
        {sections.map((entry) => {
          const selected = entry.provider === activeProvider
          return (
            <button
              key={entry.provider}
              type="button"
              role="tab"
              aria-selected={selected}
              className="composer-model-tab"
              data-ui-key={entry.provider}
              onClick={() => setActiveProvider(entry.provider)}
            >
              <ProviderMark provider={entry.provider} className="composer-model-tab-mark" aria-hidden="true" />
              <span className="composer-model-tab-label">{entry.label}</span>
            </button>
          )
        })}
      </div>
      {showSearch && (
        <input
          type="search"
          className="composer-model-search"
          aria-label="Filter models"
          placeholder="Filter…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      )}
      <div className="composer-model-list" role="radiogroup" aria-label={`${section?.label ?? 'Model'} models`}>
        {listed.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            checked={model.id === selectedModel}
            disabled={disabled}
            onChoose={onChoose}
          />
        ))}
        {listed.length === 0 && (
          <p className="composer-model-empty">No models match.</p>
        )}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="composer-model-more"
          data-ui="composer.model-more"
          data-ui-key={section!.provider}
          onClick={() => setExpanded(true)}
        >
          Show {hiddenCount} more {hiddenCount === 1 ? 'model' : 'models'}
        </button>
      )}
    </section>
  )
}

function ModelRow({
  model,
  checked,
  disabled,
  onChoose
}: {
  model: ChatModel
  checked: boolean
  disabled: boolean
  onChoose: (modelId: string) => void
}): JSX.Element {
  const context = modelContextLabel(model.contextWindow)
  const title = [model.description.trim(), context ? `${context} context` : ''].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className="composer-model-row"
      data-ui="composer.model-item"
      data-ui-key={model.id}
      title={title || undefined}
      disabled={disabled}
      onClick={() => { if (!checked) onChoose(model.id) }}
    >
      <Check className="composer-model-row-check" aria-hidden="true" />
      <span className="composer-model-row-name">{model.displayName}</span>
      {context && <span className="composer-model-row-badge">{context}</span>}
    </button>
  )
}
