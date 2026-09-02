import type { ChatModel, ChatReasoningEffort } from '../../shared/chat.js'
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { reasoningEffortForModel, type ChatModelCatalog } from '../chat-model-catalog.js'
import { claudeModelId } from './claude-ids.js'

// The Claude catalog is read live from the CLI (`Query.supportedModels()`), never hardcoded:
// the CLI knows which models the signed-in account can use and what each supports. Verified
// 2026-09-02 against SDK 0.3.258: entries carry `value` (the `model` option), `resolvedModel`,
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
    models.push({
      provider: 'claude',
      id: claudeModelId(info.value),
      displayName: info.displayName || info.value,
      description: info.description ?? '',
      defaultReasoningEffort: CLAUDE_DEFAULT_EFFORT,
      supportedReasoningEfforts: effortOptions(info),
      isDefault: defaultTarget !== null && identity === defaultTarget
    })
  }
  if (models.length > 0 && !models.some((model) => model.isDefault)) models[0]!.isDefault = true
  return models
}

function effortOptions(info: ModelInfo): ChatReasoningEffort[] {
  if (info.supportsEffort === false) return []
  const levels = info.supportedEffortLevels ?? []
  return levels.map((level) => ({ reasoningEffort: level, description: EFFORT_DESCRIPTIONS[level] ?? '' }))
}

/** The catalog with the saved preference applied, in the shape ChatModelState loads. */
export function claudeModelCatalog(
  infos: readonly ModelInfo[],
  preferredModel: string | null,
  preferredEffort: string | null
): ChatModelCatalog {
  const models = claudeModelsFromInfo(infos)
  const selectedModel = models.some((model) => model.id === preferredModel)
    ? preferredModel
    : models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? null
  return { models, selectedModel, selectedReasoningEffort: reasoningEffortForModel(models, selectedModel, preferredEffort) }
}

/** Whether a catalog model accepts the adaptive-thinking request option. */
export function supportsAdaptiveThinking(infos: readonly ModelInfo[], value: string | null): boolean {
  if (!value) return infos.find((info) => info.value === 'default')?.supportsAdaptiveThinking === true
  return infos.find((info) => info.value === value)?.supportsAdaptiveThinking === true
}
