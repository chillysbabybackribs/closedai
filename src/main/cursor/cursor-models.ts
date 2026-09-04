import type { ChatModel } from '../../shared/chat.js'
import { reasoningEffortForModel, type ChatModelCatalog } from '../chat-model-catalog.js'
import type { AcpModel } from './cursor-acp.js'
import { cursorModelBase, cursorModelId } from './cursor-ids.js'

// The Cursor catalog is whatever `session/new` reports in `models.availableModels` — the
// account's enabled set, 37 entries on an Ultra plan, never hardcoded. Verified live against
// cursor-agent 2026.09.02-c22c1a3 on 2026-09-03:
// - An ACP model id is `<base>[<key>=<value>,…]`, e.g.
//   `claude-opus-5[thinking=true,context=300k,effort=high,fast=false]`, with a display `name`
//   that is just the base (`claude-opus-5`). `default[]` is "Auto".
// - `session/set_model` accepts ONLY an id that appears verbatim in `availableModels`. Every
//   bracket override was rejected with "Invalid model value", including efforts the one-shot
//   `cursor-agent models` listing does advertise (`effort=xhigh`, `effort=max`).
//
// So the bracket is descriptive here, not a control surface: there is exactly one entry per
// base model and no reasoning-effort ladder to offer. Composer ids carry the full ACP id so a
// selection round-trips verbatim, and the parsed parameters become the model's description.

export type CursorModelParams = { base: string; params: Record<string, string> }

const ID_SHAPE = /^([^[\]]+)\[([^\]]*)\]$/

/** Split `base[k=v,…]` into its parts; an id without a bracket is all base. */
export function parseCursorModelId(modelId: string): CursorModelParams {
  const match = ID_SHAPE.exec(modelId.trim())
  if (!match) return { base: modelId.trim(), params: {} }
  const params: Record<string, string> = {}
  for (const pair of match[2]!.split(',')) {
    const [key, ...rest] = pair.split('=')
    const name = key?.trim()
    if (name) params[name] = rest.join('=').trim()
  }
  return { base: match[1]!.trim(), params }
}

/** What the bracket says about a model, in the pane's words. */
export function describeCursorModel(params: Record<string, string>): string {
  const parts: string[] = []
  if (params.thinking === 'true') parts.push('Thinking')
  const effort = params.effort ?? params.reasoning
  if (effort) parts.push(`${effort} effort`)
  if (params.context) parts.push(`${params.context} context`)
  if (params.fast === 'true') parts.push('Fast')
  return parts.length ? `${parts.join(' · ')} — on your Cursor subscription` : 'On your Cursor subscription'
}

/** Composer models: one per ACP entry, since only a listed id can be selected. */
export function cursorModelsFromAcp(acpModels: readonly AcpModel[], currentModelId: string | null): ChatModel[] {
  const models = acpModels.map((model): ChatModel => {
    const { params } = parseCursorModelId(model.modelId)
    return {
      provider: 'cursor',
      id: cursorModelId(model.modelId),
      displayName: model.name,
      description: describeCursorModel(params),
      // The effort is baked into the id the agent accepts, so the pane offers no effort control.
      defaultReasoningEffort: '',
      supportedReasoningEfforts: [],
      isDefault: currentModelId !== null && model.modelId === currentModelId
    }
  })
  if (models.length && !models.some((model) => model.isDefault)) models[0]!.isDefault = true
  return models
}

/** The ACP `modelId` behind a composer selection, or null when nothing Cursor is selected. */
export function cursorAcpModelId(modelId: string | null | undefined): string | null {
  return cursorModelBase(modelId)
}

/** The catalog with the saved preference applied, in the shape ChatModelState loads. */
export function cursorModelCatalog(
  acpModels: readonly AcpModel[],
  currentModelId: string | null,
  preferredModel: string | null,
  preferredEffort: string | null = null
): ChatModelCatalog {
  const models = cursorModelsFromAcp(acpModels, currentModelId)
  const selectedModel = models.some((model) => model.id === preferredModel)
    ? preferredModel
    : models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? null
  return { models, selectedModel, selectedReasoningEffort: reasoningEffortForModel(models, selectedModel, preferredEffort) }
}
