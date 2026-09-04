import type { ChatModel, ChatProvider } from '../shared/chat.js'
import { CHAT_PROVIDERS } from '../shared/chat-providers.js'
import { PROVIDER_LABELS } from './chat-state.js'

// Pure state for the composer's model menu: what the trigger reads and how the menu groups.

export type ModelGroup = { provider: ChatProvider; label: string; models: ChatModel[] }

const PROVIDER_ORDER: readonly ChatProvider[] = CHAT_PROVIDERS

/** Models grouped by provider in a fixed order; providers without models are omitted. */
export function modelGroups(models: ChatModel[]): ModelGroup[] {
  return PROVIDER_ORDER.flatMap((provider) => {
    const entries = models.filter((model) => model.provider === provider)
    return entries.length ? [{ provider, label: PROVIDER_LABELS[provider], models: entries }] : []
  })
}

/** "Low" / "Xhigh" → "Low" / "XHigh"-free plain casing the picker has always used. */
export function effortLabel(effort: string): string {
  return effort.split(/[-_]/).map((part) => (part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : '')).join(' ')
}

/** The trigger text: the model's name, and the effort as a quiet suffix when the model has one. */
export function modelTriggerLabel(
  models: ChatModel[],
  selectedModel: string | null,
  selectedEffort: string | null
): { name: string; context: string | null; effort: string | null; description: string } {
  const model = models.find((entry) => entry.id === selectedModel)
  if (!model) return { name: models.length ? 'Choose model' : 'No models', context: null, effort: null, description: '' }
  const effort = model.supportedReasoningEfforts.find((option) => option.reasoningEffort === selectedEffort)
  return {
    name: model.displayName,
    context: modelContextLabel(model.contextWindow),
    effort: effort ? effortLabel(effort.reasoningEffort) : null,
    description: model.description
  }
}

/** Compact, stable context labels for both the resting trigger and catalog rows. */
export function modelContextLabel(tokens: number | undefined): string | null {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return null
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(Math.round(tokens))
}

/** How many of each provider's models the menu shows before the rest are folded away. */
export const FEATURED_MODELS_PER_PROVIDER = 4

/** How many times the picker has been used for each model id. */
export type ModelUsage = Readonly<Record<string, number>>

export type ProviderSection = {
  provider: ChatProvider
  label: string
  /** The short list this provider's submenu opens on. */
  featured: ChatModel[]
  /** Every model this provider offers. */
  all: ChatModel[]
  /** How many models `featured` leaves out; 0 when the submenu already shows everything. */
  hiddenCount: number
}

/**
 * The menu opens on the providers rather than the catalogue: one row each, and the models
 * behind it. That already answers the wall-of-names problem the flat list had, but a single
 * provider can still be long on its own (37 Cursor models against four Codex ones), so each
 * submenu keeps the same short-list rule the flat menu used to apply globally.
 *
 * Within a provider the ranking is by how often the picker has been used for a model, then its
 * default, then catalogue order. The selected model is always featured — its checkmark has to
 * be visible without expanding — and a remainder of one is featured too, rather than hidden
 * behind a row that reveals a single name.
 */
export function providerSections(
  models: ChatModel[],
  usage: ModelUsage,
  selectedModel: string | null,
  limit = FEATURED_MODELS_PER_PROVIDER
): ProviderSection[] {
  return modelGroups(models).map(({ provider, label, models: all }) => {
    const featured = featuredModels(all, usage, selectedModel, limit)
    const hiddenCount = all.length - featured.length
    return hiddenCount <= 1
      ? { provider, label, featured: all, all, hiddenCount: 0 }
      : { provider, label, featured, all, hiddenCount }
  })
}

/** One provider's featured slots, filled by rank but listed back in catalogue order. */
function featuredModels(entries: ChatModel[], usage: ModelUsage, selectedModel: string | null, limit: number): ChatModel[] {
  const ranked = [...entries].sort((a, b) => (
    Number(b.id === selectedModel) - Number(a.id === selectedModel)
    || (usage[b.id] ?? 0) - (usage[a.id] ?? 0)
    || Number(b.isDefault) - Number(a.isDefault)
  ))
  const keep = new Set(ranked.slice(0, limit).map((model) => model.id))
  return entries.filter((model) => keep.has(model.id))
}

/** Stored usage counts, ignoring anything that is not a positive count. */
export function parseModelUsage(raw: string | null): ModelUsage {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const usage: Record<string, number> = {}
    for (const [id, count] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) usage[id] = count
    }
    return usage
  } catch {
    return {}
  }
}

/** One more use of a model. */
export function countModelUse(usage: ModelUsage, modelId: string): ModelUsage {
  return { ...usage, [modelId]: (usage[modelId] ?? 0) + 1 }
}
