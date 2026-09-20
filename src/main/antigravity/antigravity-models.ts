import type { ChatModel, ChatReasoningEffort } from '../../shared/chat.js'
import { reasoningEffortForModel, type ChatModelCatalog } from '../chat-model-catalog.js'
import { antigravityModelFamily, antigravityModelId } from './antigravity-ids.js'

// The Antigravity catalog is read live from `agy models`, never hardcoded: the CLI self-updates
// and drops ids (a dropped id fails a turn instantly with "invalid model selection"). Verified
// 2026-09-02 against agy 1.1.24: one `<id>\t<display name>` line per model after a "Fetching
// available models..." banner; effort is baked into the id as a `-low|-medium|-high` suffix
// ("Gemini 3.8 Flash (High)"). The picker shows one entry per family and drives the suffix
// through the shared effort control, so `agy:gemini-3.8-flash` + `high` sends
// `gemini-3.8-flash-high`. Families without a suffix (the Claude models) take no effort.

export type AntigravityCliModel = { id: string; displayName: string }

const EFFORT_SUFFIX = /-(low|medium|high)$/
const EFFORT_ORDER = ['low', 'medium', 'high'] as const
const EFFORT_DESCRIPTIONS: Record<string, string> = {
  low: 'Fastest; minimal thinking',
  medium: 'Balanced thinking',
  high: 'Deepest reasoning'
}

/** The `agy models` listing as id/name pairs; non-matching lines (banners) are skipped. */
export function parseAntigravityModelList(stdout: string): AntigravityCliModel[] {
  const models: AntigravityCliModel[] = []
  for (const line of stdout.split('\n')) {
    const match = /^([a-z0-9][a-z0-9.-]*)\t(.+)$/i.exec(line.trim())
    if (match) models.push({ id: match[1]!, displayName: match[2]!.trim() })
  }
  return models
}

/**
 * Context window capacity in tokens for Antigravity models.
 * Gemini 3.x models support 1,000,000 tokens; Claude models support 200,000 tokens;
 * and GPT-OSS models support 128,000 tokens.
 */
export function antigravityContextWindow(modelIdOrFamily: string | null | undefined): number {
  if (!modelIdOrFamily) return 1_000_000
  const normalized = (antigravityModelFamily(modelIdOrFamily) ?? modelIdOrFamily).toLowerCase()
  if (normalized.startsWith('claude')) return 200_000
  if (normalized.startsWith('gpt')) return 128_000
  return 1_000_000
}

/** Composer models: one per family, with the CLI's effort variants as the effort options. */
export function antigravityModelsFromCli(cliModels: readonly AntigravityCliModel[]): ChatModel[] {
  const families = new Map<string, { displayName: string; efforts: string[] }>()
  for (const model of cliModels) {
    const match = EFFORT_SUFFIX.exec(model.id)
    const family = match ? model.id.slice(0, -match[0].length) : model.id
    const entry = families.get(family) ?? { displayName: familyDisplayName(model.displayName), efforts: [] }
    if (match) entry.efforts.push(match[1]!)
    families.set(family, entry)
  }
  const models: ChatModel[] = []
  for (const [family, entry] of families) {
    const efforts = EFFORT_ORDER.filter((effort) => entry.efforts.includes(effort))
    models.push({
      provider: 'antigravity',
      id: antigravityModelId(family),
      displayName: entry.displayName,
      description: 'On your Antigravity subscription',
      contextWindow: antigravityContextWindow(family),
      defaultReasoningEffort: efforts.includes('high') ? 'high' : efforts[0] ?? '',
      supportedReasoningEfforts: efforts.map((effort): ChatReasoningEffort => ({ reasoningEffort: effort, description: EFFORT_DESCRIPTIONS[effort] ?? '' })),
      isDefault: false
    })
  }
  if (models.length) models[0]!.isDefault = true
  return models
}

function familyDisplayName(displayName: string): string {
  return displayName.replace(/\s*\((?:Low|Medium|High)\)\s*$/i, '').replace(/\s*\(Thinking\)\s*$/i, '').trim() || displayName
}

/** The `--model` wire name for a composer selection, or null when nothing is selected. */
export function antigravityWireModel(models: readonly ChatModel[], modelId: string | null, effort: string | null): string | null {
  const family = antigravityModelFamily(modelId)
  if (!family) return null
  const model = models.find((entry) => entry.id === modelId)
  if (!model || model.supportedReasoningEfforts.length === 0) return family
  const chosen = model.supportedReasoningEfforts.some((option) => option.reasoningEffort === effort) ? effort : model.defaultReasoningEffort
  return `${family}-${chosen}`
}

/** The catalog with the saved preference applied, in the shape ChatModelState loads. */
export function antigravityModelCatalog(
  cliModels: readonly AntigravityCliModel[],
  preferredModel: string | null,
  preferredEffort: string | null
): ChatModelCatalog {
  const models = antigravityModelsFromCli(cliModels)
  const selectedModel = models.some((model) => model.id === preferredModel)
    ? preferredModel
    : models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? null
  return { models, selectedModel, selectedReasoningEffort: reasoningEffortForModel(models, selectedModel, preferredEffort) }
}
