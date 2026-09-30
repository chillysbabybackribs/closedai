import type { ChatModel, ChatProvider, ChatSnapshot } from '../shared/chat.js'
import { CHAT_PROVIDER_LABELS } from '../shared/chat-providers.js'
import type { AppSettingsAccess } from './app-settings-store.js'
import { buildThreadHandoff } from './chat-context/thread-handoff.js'
import type { ChatMemoryCheckpoint } from '../shared/chat-memory.js'
import type { ChatHubProviders, ChatProviderService } from './chat-hub.js'

/** The chat a model switch brought with it, shown above the destination provider's own messages. */
export type CarriedHistory = { provider: ChatProvider; threadName: string | null; items: ChatSnapshot['items'] }

export type ChatHubSwitchHost = {
  active(): ChatProvider
  setActive(provider: ChatProvider): void
  dormant: Set<ChatProvider>
  switching(): Promise<void> | null
  setSwitching(promise: Promise<void> | null): void
  warmPromise(): Promise<void> | null
  setWarmPromise(promise: Promise<void> | null): void
  carriedHistory(): CarriedHistory | null
  setCarriedHistory(history: CarriedHistory | null): void
  providers: ChatHubProviders
  settings: AppSettingsAccess
  checkpoint: (() => ChatMemoryCheckpoint | null) | null
  current(): ChatProviderService
  models(): ChatSnapshot['models']
  cachedModel(modelId: string): ChatModel | null
  isReady(name: ChatProvider): boolean
  merge(snapshot: ChatSnapshot): ChatSnapshot
  emitReplace(snapshot: ChatSnapshot): void
  emitEvent(event: import('../shared/chat.js').ChatEvent): void
}

export function effortForModel(model: ChatModel, preferred: string | null): string | null {
  if (preferred && model.supportedReasoningEfforts.some((option) => option.reasoningEffort === preferred)) return preferred
  return model.defaultReasoningEffort || null
}

export async function rememberModelChoice(host: ChatHubSwitchHost, model: ChatModel): Promise<string | null> {
  const saved = host.settings.get()
  const effort = effortForModel(model, saved.chatReasoningEffort)
  if (saved.chatModelId !== model.id || saved.chatReasoningEffort !== effort) {
    await host.settings.set({ chatModelId: model.id, chatReasoningEffort: effort })
  }
  return effort
}

export function prefetchDormantProvider(host: ChatHubSwitchHost): void {
  if (!host.dormant.has(host.active()) || host.warmPromise()) return
  const warm = doStartIfDormant(host).finally(() => { host.setWarmPromise(null) })
  host.setWarmPromise(warm)
  void warm.catch(() => undefined)
}

export async function startIfDormant(host: ChatHubSwitchHost): Promise<void> {
  const warming = host.warmPromise()
  if (warming) {
    await warming.catch(() => undefined)
    return
  }
  await doStartIfDormant(host)
}

async function doStartIfDormant(host: ChatHubSwitchHost): Promise<void> {
  if (!host.dormant.has(host.active())) return
  const active = host.active()
  const provider = host.providers[active]
  if (!host.isReady(active)) await provider.start({ warm: true })
  const saved = host.settings.get()
  const loaded = provider.snapshot({ limit: 0 })
  if (saved.chatModelId && loaded.selectedModel !== saved.chatModelId) {
    await provider.selectModel(saved.chatModelId)
  } else if (saved.chatReasoningEffort && loaded.selectedReasoningEffort !== saved.chatReasoningEffort) {
    const model = loaded.models.find((entry) => entry.id === loaded.selectedModel)
    // A saved effort from a previously selected model (e.g. Sonnet) may not exist on this
    // one (e.g. Haiku, which supports none) — applying it unconditionally throws.
    if (model?.supportedReasoningEfforts.some((option) => option.reasoningEffort === saved.chatReasoningEffort)) {
      await provider.selectReasoningEffort(saved.chatReasoningEffort)
    }
  }
  host.dormant.delete(host.active())
}

export async function switchDormantProvider(
  host: ChatHubSwitchHost,
  source: ChatSnapshot,
  target: ChatProvider,
  model: ChatModel
): Promise<void> {
  if (source.activeTurnId) throw new Error('Stop the current turn before switching models')
  const previous = host.active()
  await rememberModelChoice(host, model)
  host.setActive(target)
  host.dormant.add(target)
  host.emitReplace(host.merge(preserveSourceHistory(host, source, host.current().snapshot({ limit: 0 }))))
  const switching = (async () => {
    try {
      await carryConversation(host, source, target)
      host.providers[previous].stop()
      prefetchDormantProvider(host)
      host.emitReplace(host.merge(preserveSourceHistory(host, source, host.current().snapshot({ limit: 0 }))))
    } catch (error) {
      host.setActive(previous)
      host.dormant.delete(target)
      host.emitReplace(host.merge(host.current().snapshot({ limit: 0 })))
      throw error
    } finally {
      host.setSwitching(null)
    }
  })()
  host.setSwitching(switching)
  await switching
}

export async function switchToProvider(
  host: ChatHubSwitchHost,
  source: ChatSnapshot,
  target: ChatProvider,
  action: () => Promise<void>,
  optimistic: Partial<ChatSnapshot>
): Promise<void> {
  if (source.activeTurnId) throw new Error('Stop the current turn before switching models')
  const previous = host.active()
  host.setActive(target)
  host.dormant.delete(target)
  host.emitReplace({ ...host.merge(preserveSourceHistory(host, source, host.current().snapshot({ limit: 0 }))), ...optimistic })
  const switching = (async () => {
    try {
      const targetState = host.providers[target].snapshot({ limit: 0 }).connection.state
      if (targetState !== 'ready' && targetState !== 'signed-out') await host.providers[target].start({ warm: true })
      await action()
      host.providers[previous].stop()
      await persistActiveModel(host)
      host.emitReplace(host.merge(preserveSourceHistory(host, source, host.current().snapshot({ limit: 0 }))))
    } catch (error) {
      host.setActive(previous)
      host.emitReplace(host.merge(host.current().snapshot({ limit: 0 })))
      throw error
    } finally {
      host.setSwitching(null)
    }
  })()
  host.setSwitching(switching)
  await switching
}

export async function carryConversation(host: ChatHubSwitchHost, source: ChatSnapshot, target: ChatProvider): Promise<void> {
  const savedCheckpoint = host.checkpoint?.() ?? null
  const checkpoint = savedCheckpoint?.threadId === source.threadId
    && source.items.some((item) => item.id === savedCheckpoint.throughItemId) ? savedCheckpoint : null
  const handoff = buildThreadHandoff(source.items, source.threadName, checkpoint, { maxChars: host.settings.get().chatHandoffTargetChars })
  host.setCarriedHistory(null)
  if (handoff) {
    await host.providers[target].continueInNewThread({
      ...handoff,
      provider: source.provider,
      threadId: source.threadId,
      sourceThroughItemId: source.items.at(-1)?.id ?? null,
      checkpoint
    })
    host.setCarriedHistory({ provider: target, threadName: source.threadName, items: source.items })
    return
  }
  const pending = host.settings.get().chatContinuation
  await host.providers[target].newThread()
  if (pending?.handoff && !host.settings.get().chatContinuation) await host.settings.set({ chatContinuation: pending })
}

export function preserveSourceHistory(host: ChatHubSwitchHost, source: ChatSnapshot, target: ChatSnapshot): ChatSnapshot {
  if (host.carriedHistory() || source.activeTurnId || source.items.length === 0) return target
  if (target.provider === source.provider || target.items.length > 0) return target
  return { ...target, threadName: target.threadName ?? source.threadName, items: source.items }
}

export function paneViewForActive(
  active: ChatProvider,
  dormant: Set<ChatProvider>,
  settings: AppSettingsAccess,
  snapshot: ChatSnapshot
): ChatSnapshot {
  if (snapshot.provider !== active) return snapshot
  const saved = settings.get()
  if (dormant.has(active)) {
    const connection = snapshot.connection.state === 'ready'
      ? snapshot.connection
      : { state: 'ready' as const, message: `${CHAT_PROVIDER_LABELS[active]} starts with your first message` }
    return { ...snapshot, connection, selectedModel: saved.chatModelId, selectedReasoningEffort: saved.chatReasoningEffort }
  }
  if (snapshot.selectedModel) return snapshot
  return {
    ...snapshot,
    selectedModel: saved.chatModelId,
    selectedReasoningEffort: snapshot.selectedReasoningEffort ?? saved.chatReasoningEffort
  }
}

export async function persistActiveModel(host: ChatHubSwitchHost): Promise<void> {
  const { selectedModel, selectedReasoningEffort } = host.current().snapshot({ limit: 0 })
  if (!selectedModel) return
  const saved = host.settings.get()
  if (saved.chatModelId === selectedModel && saved.chatReasoningEffort === selectedReasoningEffort) return
  try {
    await host.settings.set({ chatModelId: selectedModel, chatReasoningEffort: selectedReasoningEffort })
  } catch (error) {
    console.warn('[chat] could not persist the pane model:', error instanceof Error ? error.message : String(error))
  }
}
