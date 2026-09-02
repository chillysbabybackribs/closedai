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
