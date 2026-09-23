import type { ChatModel, ChatReasoningEffort } from '../../shared/chat.js'
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { reasoningEffortForModel, type ChatModelCatalog } from '../chat-model-catalog.js'
import { claudeModelId, claudeModelValue } from './claude-ids.js'

// The Claude catalog is read live from the CLI (`Query.supportedModels()`), never hardcoded:
// the CLI knows which models the signed-in account can use and what each supports. Verified
// 2026-09-02 against SDK 0.3.258, rechecked 0.3.280: entries carry `value` (the `model` option), `resolvedModel`,
// display name, description, and `supportedEffortLevels`; Haiku 4.5 reports no effort support.

/** The effort the CLI runs at when no option is sent (verified through a PreToolUse hook). */
export const CLAUDE_DEFAULT_EFFORT = 'high'

const EFFORT_DESCRIPTIONS: Record<string, string> = {
  low: 'Fastest; minimal thinking',
  medium: 'Moderate thinking',
  high: 'Deep reasoning (Claude Code default)',
  xhigh: 'Deeper than high; best for long agentic work',
  max: 'Maximum effort'
}

/** Picker order: lighter models first within the Claude section. */
const FAMILY_RANK: Record<string, number> = { haiku: 0, sonnet: 1, fable: 2, opus: 3 }

/** Composer models for the CLI's catalog. Aliases of the same model collapse to one entry. */
export function claudeModelsFromInfo(infos: readonly ModelInfo[]): ChatModel[] {
  const defaultTarget = infos.find((info) => info.value === 'default')?.resolvedModel ?? null
  const seen = new Set<string>()
  const models: ChatModel[] = []
  for (const info of infos) {
    if (!info.value || info.value === 'default') continue
    const identity = info.resolvedModel ?? info.value
    if (seen.has(identity)) continue
    seen.add(identity)
    const contextWindow = claudeContextWindow(info)
    models.push({
      provider: 'claude',
      id: claudeModelId(info.value),
      displayName: claudeDisplayName(info),
      description: info.description ?? '',
      ...(contextWindow ? { contextWindow } : {}),
      defaultReasoningEffort: CLAUDE_DEFAULT_EFFORT,
      supportedReasoningEfforts: effortOptions(info),
      ...(info.supportsFastMode ? { supportsFastMode: true } : {}),
      isDefault: defaultTarget !== null && identity === defaultTarget
    })
  }
  const sorted = sortClaudeModels(models, infos)
  if (sorted.length > 0 && !sorted.some((model) => model.isDefault)) sorted[0]!.isDefault = true
  return sorted
}

/** Context capacity for the picker and rotation heuristics when the CLI does not spell it out. */
export function claudeContextWindow(info: Pick<ModelInfo, 'value' | 'resolvedModel' | 'displayName' | 'description'>): number | undefined {
  const raw = `${info.resolvedModel ?? ''} ${info.value} ${info.displayName ?? ''} ${info.description ?? ''}`
  if (/\[1m\]|1\s*m\s*context|1m context/i.test(raw)) return 1_000_000
  if (/\b200\s*k\b|200k context/i.test(raw)) return 200_000
  if (/haiku/i.test(raw)) return 200_000
  if (/opus|sonnet|fable/i.test(raw)) return 200_000
  return undefined
}

function sortClaudeModels(models: ChatModel[], infos: readonly ModelInfo[]): ChatModel[] {
  const valueById = new Map(models.map((model) => [model.id, claudeModelValue(model.id)]))
  const infoByValue = new Map(infos.map((info) => [info.value, info]))
  const rank = (model: ChatModel): number => {
    const value = valueById.get(model.id) ?? ''
    const info = infoByValue.get(value)
    const raw = (info?.resolvedModel ?? value).toLowerCase()
    for (const [family, order] of Object.entries(FAMILY_RANK)) {
      if (raw.includes(family)) return order
    }
    return 99
  }
  return [...models].sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName))
}

/**
 * The CLI's display names drop the version ("Fable", "Opus (1M context)"); the picker shows the
 * full model so Fable 5.1 is never mistaken for Fable 5. Derived from the resolved model id
 * (`claude-fable-5-1` → "Fable 5.1", `claude-haiku-4-5-20251001` → "Haiku 4.5"), with the
 * context tier kept as a suffix; the CLI's name stands in when an id does not parse.
 */
export function claudeDisplayName(info: Pick<ModelInfo, 'value' | 'resolvedModel' | 'displayName'>): string {
  const raw = info.resolvedModel ?? info.value
  const oneMillion = /\[1m\]/i.test(raw) || /\[1m\]/i.test(info.value) || /1M context/i.test(info.displayName ?? '')
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?(?:\[.*\])?$/i.exec(raw)
  if (!match) return info.displayName || info.value
  const family = `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}`
  const version = match[3] ? `${match[2]}.${match[3]}` : match[2]
  return `${family} ${version}${oneMillion ? ' (1M)' : ''}`
}

function effortOptions(info: ModelInfo): ChatReasoningEffort[] {
  if (info.supportsEffort === false) return []
  const levels = info.supportedEffortLevels ?? []
  return levels.map((level) => ({ reasoningEffort: level, description: EFFORT_DESCRIPTIONS[level] ?? '' }))
}

/**
 * The composer id in this catalog for a saved preference. The CLI's `value` aliases are not
 * stable across launches (`claude-fable-5-1` one day, `claude-fable-5-1[1m]` the next) while
 * `resolvedModel` names the same model throughout, so a saved id that no longer appears
 * verbatim is matched through the model it resolved to. Null when nothing corresponds.
 */
export function resolveClaudeModelId(infos: readonly ModelInfo[], preferredModel: string | null): string | null {
  const value = claudeModelValue(preferredModel)
  if (!value) return null
  const exact = infos.find((info) => info.value === value && info.value !== 'default')
  if (exact) return claudeModelId(exact.value)
  // The saved alias is gone; find what it pointed at, then the alias that points there now.
  const target = infos.find((info) => info.value === value)?.resolvedModel ?? value
  const stripTier = (id: string): string => id.replace(/\[.*\]$/, '')
  const sameModel = infos.find((info) => info.value !== 'default'
    && (info.resolvedModel === target || info.value === target || stripTier(info.resolvedModel ?? info.value) === stripTier(target)))
  return sameModel ? claudeModelId(sameModel.value) : null
}

/** The catalog with the saved preference applied, in the shape ChatModelState loads. */
export function claudeModelCatalog(
  infos: readonly ModelInfo[],
  preferredModel: string | null,
  preferredEffort: string | null
): ChatModelCatalog {
  const models = claudeModelsFromInfo(infos)
  const resolved = resolveClaudeModelId(infos, preferredModel)
  const selectedModel = resolved && models.some((model) => model.id === resolved)
    ? resolved
    : models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? null
  return { models, selectedModel, selectedReasoningEffort: reasoningEffortForModel(models, selectedModel, preferredEffort) }
}

/** Whether a catalog model accepts the adaptive-thinking request option. */
export function supportsAdaptiveThinking(infos: readonly ModelInfo[], value: string | null): boolean {
  if (!value) return infos.find((info) => info.value === 'default')?.supportsAdaptiveThinking === true
  return infos.find((info) => info.value === value)?.supportsAdaptiveThinking === true
}
