import type { ChatModel } from '../shared/chat.js'
import type { ChatModelCatalog } from './chat-model-catalog.js'
import { reasoningEffortForModel } from './chat-model-catalog.js'

export type ModelPreference = {
  model: string
  effort: string | null
}

/** Owns validation and compatibility rules for the paired model/effort preference. */
export class ChatModelState {
  models: ChatModel[] = []
  selectedModel: string | null = null
  selectedReasoningEffort: string | null = null

  load(catalog: ChatModelCatalog): void {
    this.models = catalog.models
    this.selectedModel = catalog.selectedModel
    this.selectedReasoningEffort = catalog.selectedReasoningEffort
  }

  clear(): void {
    this.models = []
    this.selectedModel = null
    this.selectedReasoningEffort = null
  }

  preferenceForModel(model: string): ModelPreference {
    if (!this.models.some((entry) => entry.id === model)) throw new Error('That Codex model is not available')
    return { model, effort: reasoningEffortForModel(this.models, model, this.selectedReasoningEffort) }
  }

  preferenceForEffort(effort: string): ModelPreference {
    const selected = this.models.find((model) => model.id === this.selectedModel)
    if (!selected?.supportedReasoningEfforts.some((option) => option.reasoningEffort === effort)) {
      throw new Error('That reasoning effort is not available for this Codex model')
    }
    return { model: selected.id, effort }
  }

  apply(preference: ModelPreference): void {
    this.selectedModel = preference.model
    this.selectedReasoningEffort = preference.effort
  }

  /**
   * Take what a resumed thread reports about itself, but only where the pane has no saved
   * choice of its own. Every turn is sent with the pane's model and effort, so letting the
   * thread's overwrite a saved preference is what made a model selection last only until the
   * next relaunch.
   */
  adoptResumed(saved: { model: string | null; effort: string | null }, reported: { model: unknown; effort: unknown }): void {
    this.adopt(saved.model ?? reported.model, saved.effort ?? reported.effort)
  }

  adopt(model: unknown, effort?: unknown): void {
    if (typeof model !== 'string' || !this.models.some((entry) => entry.id === model)) return
    this.apply({
      model,
      effort: reasoningEffortForModel(
        this.models,
        model,
        typeof effort === 'string' ? effort : this.selectedReasoningEffort
      )
    })
  }
}
