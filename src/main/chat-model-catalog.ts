import type { ChatModel } from '../shared/chat.js'
import type { AppServerClient } from './app-server-client.js'
import { normalizeModels } from './chat-normalizers.js'

type ModelListPage = {
  data?: unknown
  nextCursor?: unknown
}

export type ChatModelCatalog = {
  models: ChatModel[]
  selectedModel: string | null
  selectedReasoningEffort: string | null
}

/** Fetch every visible model the signed-in Codex account advertises. */
export async function loadChatModels(
  client: Pick<AppServerClient, 'request'>,
  preferredModel: string | null,
  preferredReasoningEffort: string | null = null
): Promise<ChatModelCatalog> {
  const models: ChatModel[] = []
  const seenIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  do {
    const response: ModelListPage = await client.request<ModelListPage>('model/list', {
      limit: 100,
      includeHidden: false,
      ...(cursor ? { cursor } : {})
    })
    for (const model of normalizeModels(response.data)) {
      if (seenIds.has(model.id)) continue
      seenIds.add(model.id)
      models.push(model)
    }
    const next: string | null = typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null
    cursor = next && !seenCursors.has(next) ? next : null
    if (cursor) seenCursors.add(cursor)
  } while (cursor)

  const selectedModel = models.some((model) => model.id === preferredModel)
    ? preferredModel
    : models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? null
  return {
    models,
    selectedModel,
    selectedReasoningEffort: reasoningEffortForModel(models, selectedModel, preferredReasoningEffort)
  }
}

export function reasoningEffortForModel(
  models: ChatModel[],
  modelId: string | null,
  preferred: string | null
): string | null {
  const model = models.find((entry) => entry.id === modelId)
  if (!model) return null
  const supported = model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort)
  if (preferred && supported.includes(preferred)) return preferred
  if (supported.includes(model.defaultReasoningEffort)) return model.defaultReasoningEffort
  return supported[0] ?? null
}
