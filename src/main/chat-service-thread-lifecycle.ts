import { isDeepStrictEqual } from 'node:util'
import { readThreadMetadata } from './chat-thread-origin.js'
import type { ChatSnapshot, ChatThreadContent, ChatEvent } from '../shared/chat.js'
import { applyProviderRotation, type RotationSettingsAccess } from './chat-context/rotate-provider-session.js'
import type { ChatSessionRotationReason } from '../shared/session-rotation.js'
import { resumeThreadParams, startThreadParams, type ThreadResponse } from './chat-context/thread-params.js'
import { nullableString, recordOf } from './chat-normalizers.js'
import { messageOf } from './error-message.js'
import { ChatTranscript } from './chat-transcript.js'
import type { ContextCompactor } from './chat-context/context-compaction.js'
import type { SessionRotator } from './chat-context/session-rotation.js'
import type { ChatModelState } from './chat-model-state.js'
import { toolSliceTurnInput } from './chat-context/chat-self-development.js'
import { resolveCodexToolCatalog } from './tools/codex-tool-catalog.js'
import type { ToolRegistry } from './tools/registry.js'
import type { CodexRuntimeSession } from './codex-workspace-runtime.js'
import type { TurnSurfaceContext } from './chat-context/turn-context.js'
import { traceLog } from './trace/trace-log.js'

export const CHAT_SERVICE_THREAD_CACHE_LIMIT = 8

export type ChatServiceThreadHost = {
  cwd: string
  client: CodexRuntimeSession
  tools: ToolRegistry
  settings: RotationSettingsAccess
  paneId: string | null
  threadId(): string | null
  threadName(): string | null
  threadToolCatalog(): unknown
  transcript: ChatTranscript
  compactor: ContextCompactor
  rotator: SessionRotator
  modelState: ChatModelState
  threadCache: Map<string, ChatThreadContent>
  ensureConnected(): Promise<void>
  contextManager(): ContextCompactor | SessionRotator
  snapshot(): ChatSnapshot
  emitEvent(event: ChatEvent): void
  setThreadId(id: string | null): void
  setThreadName(name: string | null): void
  setThreadToolCatalog(catalog: unknown): void
  setActiveTurnId(id: string | null): void
  surfaceContext(): TurnSurfaceContext | null
}

export function rememberThreadCache(host: ChatServiceThreadHost, threadId: string, content: ChatThreadContent): void {
  host.threadCache.delete(threadId)
  host.threadCache.set(threadId, content)
  if (host.threadCache.size <= CHAT_SERVICE_THREAD_CACHE_LIMIT) return
  const oldest = host.threadCache.keys().next().value
  if (oldest !== undefined) host.threadCache.delete(oldest)
}

export async function readCachedThread(host: ChatServiceThreadHost, threadId: string): Promise<ChatThreadContent> {
  const live = threadId === host.threadId()
  if (!live) {
    const cached = host.threadCache.get(threadId)
    if (cached) return cached
  }
  await host.ensureConnected()
  const response = await host.client.request<ThreadResponse>('thread/read', { threadId, includeTurns: true })
  const thread = recordOf(response.thread)
  if (typeof thread?.id !== 'string') throw new Error('Codex returned an invalid thread')
  const replay = new ChatTranscript(host.cwd, () => null, () => undefined)
  replay.replaceFromThread(thread)
  const content: ChatThreadContent = { threadId: thread.id, threadName: nullableString(thread.name), items: replay.snapshot() }
  if (!live && thread.id !== host.threadId()) rememberThreadCache(host, thread.id, content)
  return content
}

export function detachThreadState(host: ChatServiceThreadHost): void {
  host.setThreadId(null)
  host.setThreadName(null)
  host.transcript.clear()
  host.compactor.reset()
  host.rotator.reset()
  host.setActiveTurnId(null)
}

export async function resumeCodexThread(host: ChatServiceThreadHost, threadId: string): Promise<void> {
  host.threadCache.delete(threadId)
  const response = await host.client.request<ThreadResponse>(
    'thread/resume',
    resumeThreadParams(threadId, host.cwd, host.tools, selectedThreadModelSettings(host))
  )
  const thread = recordOf(response.thread)
  if (typeof thread?.id !== 'string') throw new Error('Codex returned an invalid thread')
  host.setThreadId(thread.id)
  host.setThreadName(nullableString(thread.name))
  const metadata = typeof thread.path === 'string' ? await readThreadMetadata(thread.path) : null
  host.setThreadToolCatalog(Array.isArray(metadata?.dynamic_tools) ? metadata.dynamic_tools : null)
  const saved = host.settings.get()
  host.modelState.adoptResumed(
    { model: saved.chatModelId, effort: saved.chatReasoningEffort },
    { model: response.model, effort: response.reasoningEffort }
  )
  host.transcript.replaceFromThread(thread)
  host.compactor.reset()
  host.rotator.reset()
  await host.settings.set({ chatThreadId: thread.id, chatContinuation: null })
  host.emitEvent({ type: 'replace', snapshot: host.snapshot() })
}

export async function resumePersistedCodexThread(host: ChatServiceThreadHost): Promise<void> {
  if (host.threadId()) return
  const persisted = host.settings.get().chatThreadId
  if (!persisted) return
  try {
    await resumeCodexThread(host, persisted)
  } catch (error) {
    console.warn('[app-server] could not resume saved thread:', messageOf(error))
    detachThreadState(host)
    await host.settings.set({ chatThreadId: null })
    host.emitEvent({ type: 'replace', snapshot: host.snapshot() })
  }
}

export async function rotateCodexProviderSession(
  host: ChatServiceThreadHost,
  excludeItemId?: string,
  reason?: ChatSessionRotationReason
): Promise<void> {
  try {
    await applyProviderRotation(host.settings, {
      paneId: host.paneId,
      provider: 'codex',
      threadId: host.threadId(),
      threadName: host.threadName(),
      items: host.transcript.snapshot().filter((item) => item.id !== excludeItemId),
      reason: reason ?? host.rotator.rotationReason ?? 'manual'
    }, async () => {
      host.setThreadId(null)
      host.compactor.reset()
      host.rotator.reset()
      await host.settings.set({ chatThreadId: null })
      host.emitEvent({ type: 'thread', threadId: null, threadName: host.threadName() })
    }, host.contextManager().current, {
      prefetchSource: (threadId) => { void readCachedThread(host, threadId).catch(() => undefined) }
    })
  } finally {
    host.rotator.complete()
  }
}

export async function ensureCodexThread(host: ChatServiceThreadHost, clientUserMessageId?: string): Promise<string> {
  const prompt = clientUserMessageId ? host.transcript.optimisticUserText(clientUserMessageId) : null
  const bundle = await resolveCodexToolCatalog(
    host.tools,
    host.settings.get(),
    toolSliceTurnInput(prompt, host.surfaceContext(), host.cwd)
  )
  const catalog = bundle.dynamicTools
  if (bundle.sliceId) {
    traceLog.record({ paneId: host.paneId, provider: 'codex', turnId: null }, {
      kind: 'tool',
      label: 'codex.tool_slice',
      summary: `${bundle.sliceId} (${bundle.promotedIds.length} eager)`,
      detail: { sliceId: bundle.sliceId, promotedIds: bundle.promotedIds },
      ok: true
    })
  }
  if (host.threadId() && !isDeepStrictEqual(host.threadToolCatalog(), catalog)) {
    await rotateCodexProviderSession(host, clientUserMessageId ? `user:${clientUserMessageId}` : undefined, 'toolCatalog')
    if (host.threadId()) {
      await host.settings.set({ chatThreadId: null })
      host.setThreadId(null)
    }
  }
  const existing = host.threadId()
  if (existing) return existing
  const response = await host.client.request<ThreadResponse>(
    'thread/start',
    startThreadParams(host.cwd, host.tools, selectedThreadModelSettings(host), catalog)
  )
  const thread = recordOf(response.thread)
  if (typeof thread?.id !== 'string') throw new Error('Codex returned an invalid thread')
  host.setThreadId(thread.id)
  host.setThreadToolCatalog(catalog)
  host.setThreadName(nullableString(thread.name))
  host.modelState.adopt(response.model)
  await host.settings.set({ chatThreadId: thread.id })
  host.emitEvent({ type: 'thread', threadId: thread.id, threadName: host.threadName() })
  return thread.id
}

function selectedThreadModelSettings(host: ChatServiceThreadHost): {
  model: string | null
  effort: string | null
  contextWindow?: number
} {
  return threadModelSettings(host, host.modelState.selectedModel, host.modelState.selectedReasoningEffort)
}

export function threadModelSettings(
  host: ChatServiceThreadHost,
  model: string | null,
  effort: string | null
): { model: string | null; effort: string | null; contextWindow?: number } {
  const contextWindow = host.modelState.models.find((entry) => entry.id === model)?.contextWindow
  return { model, effort, ...(contextWindow ? { contextWindow } : {}) }
}
