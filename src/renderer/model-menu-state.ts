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
): { name: string; effort: string | null; description: string } {
  const model = models.find((entry) => entry.id === selectedModel)
  if (!model) return { name: models.length ? 'Choose model' : 'No models', effort: null, description: '' }
  const effort = model.supportedReasoningEfforts.find((option) => option.reasoningEffort === selectedEffort)
  return { name: model.displayName, effort: effort ? effortLabel(effort.reasoningEffort) : null, description: model.description }
}

/** How many models the menu shows before the rest are folded away. */
export const FEATURED_MODEL_LIMIT = 5

/** How many times the picker has been used for each model id. */
export type ModelUsage = Readonly<Record<string, number>>

export type ModelSections = {
  /** The short list the menu opens on, grouped by provider. */
  featured: ModelGroup[]
  /** Every model, grouped, for when the list is expanded. */
  all: ModelGroup[]
  /** How many models the short list leaves out. */
  hiddenCount: number
}

/**
 * The catalogue is long enough that the menu became a wall of names, so it opens on the models
 * this install actually reaches for and folds the rest behind one row. Ranking is by how often
 * the picker has been used for a model; without that history it falls back to a provider
 * round-robin so a fresh install still spans every backend instead of listing one provider's
 * whole catalogue. The selected model is always featured — its checkmark has to be visible
 * without expanding — and a remainder of one is featured too, rather than hidden behind a row
 * that reveals a single name.
 */
export function modelSections(
  models: ChatModel[],
  usage: ModelUsage,
  selectedModel: string | null,
  limit = FEATURED_MODEL_LIMIT
): ModelSections {
  const all = modelGroups(models)
  const featuredIds = new Set<string>()
  if (models.some((model) => model.id === selectedModel)) featuredIds.add(selectedModel!)
  const ranked = [...baselineOrder(all)].sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
  for (const model of ranked) {
    if (featuredIds.size >= limit) break
    featuredIds.add(model.id)
  }
  const hiddenCount = models.length - featuredIds.size
  if (hiddenCount <= 1) return { featured: all, all, hiddenCount: 0 }
  return { featured: modelGroups(models.filter((model) => featuredIds.has(model.id))), all, hiddenCount }
}

/** Providers interleaved, each one's default model first: the order used before any usage exists. */
function baselineOrder(groups: ModelGroup[]): ChatModel[] {
  const lists = groups.map((group) => [...group.models].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)))
  const ordered: ChatModel[] = []
  for (let rank = 0; lists.some((list) => list.length > rank); rank += 1) {
    for (const list of lists) {
      const model = list[rank]
      if (model) ordered.push(model)
    }
  }
  return ordered
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
