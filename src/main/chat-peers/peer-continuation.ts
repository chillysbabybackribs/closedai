import type { ChatSnapshot, ChatThreadContent } from '../../shared/chat.js'
import type { ChatContinuationSource, ChatPaneId } from '../../shared/chat-peers.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import type { ChatContinuation } from '../../shared/types.js'
import { chatProviderOfId } from '../../shared/chat-providers.js'
import { buildThreadHandoff, handoffPreviewExchange } from '../chat-context/thread-handoff.js'

export type ContinuationHost = {
  current(): ChatSnapshot
  attached(paneId: string): boolean
  snapshot(paneId: string): Promise<ChatSnapshot>
  record(paneId: string): ChatRecord | undefined
  readThread(threadId: string): Promise<ChatThreadContent>
  /** Without a selection the new chat takes the focused chat's directory. */
  create(model: string | null, effort: string | null, continuation: ChatContinuation,
    selection?: { cwd: string; projectPath: string | null }): Promise<string>
}

export async function continuePeer(host: ContinuationHost, source: ChatContinuationSource, modelId: string | null): Promise<ChatPaneId> {
  if (!source?.paneId && !source?.threadId) throw new Error('Choose a chat to continue')
  const current = host.current()
  let sourceSnapshot: ChatSnapshot | null = null
  let sourceThreadId = source.threadId
  let sourceProvider = sourceThreadId ? chatProviderOfId(sourceThreadId) : current.provider
  let items: ChatSnapshot['items']
  let threadName: string | null

  if (source.paneId && host.attached(source.paneId)) {
    sourceSnapshot = await host.snapshot(source.paneId)
    if (sourceSnapshot.activeTurnId) throw new Error('Stop the current turn before continuing in a new chat')
    sourceThreadId = sourceSnapshot.threadId ?? sourceThreadId
    sourceProvider = sourceSnapshot.provider
    items = sourceSnapshot.items
    threadName = sourceSnapshot.threadName
  } else {
    // A detached chat is read from its thread without attaching it.
    const threadId = sourceThreadId ?? (source.paneId ? host.record(source.paneId)?.threadId ?? null : null)
    if (!threadId) throw new Error('There is no conversation to continue yet')
    const content = await host.readThread(threadId)
    sourceThreadId = content.threadId
    sourceProvider = chatProviderOfId(content.threadId)
    items = content.items
    threadName = content.threadName
  }

  if (source.throughItemId) {
    const index = items.findIndex((item) => item.id === source.throughItemId)
    const endpoint = items[index]
    if (!endpoint || endpoint.type !== 'assistant' || endpoint.streaming) {
      throw new Error('Choose a completed response to branch from')
    }
    items = items.slice(0, index + 1)
  }
  const sourceRecord = source.paneId ? host.record(source.paneId) : undefined
  const savedCheckpoint = sourceRecord?.checkpoint ?? null
  const checkpoint = savedCheckpoint?.threadId === sourceThreadId
    && items.some((item) => item.id === savedCheckpoint.throughItemId) ? savedCheckpoint : null
  // The work continues where it was: the digest names the source directory and the new chat
  // opens in it, rather than in whichever chat happened to hold focus.
  const cwd = sourceSnapshot?.cwd ?? sourceRecord?.cwd ?? null
  const handoff = buildThreadHandoff(items, threadName, checkpoint, { cwd })
  if (!handoff) throw new Error('There is no conversation to continue yet')
  const preview = handoffPreviewExchange(items)
  const targetModel = modelId ?? sourceSnapshot?.selectedModel ?? current.selectedModel
  const targetEffort = targetModel === sourceSnapshot?.selectedModel
    ? sourceSnapshot?.selectedReasoningEffort ?? null
    : targetModel === current.selectedModel ? current.selectedReasoningEffort : null
  const continuation: ChatContinuation = {
    sourcePaneId: source.paneId,
    sourceThreadId,
    sourceProvider,
    sourceTitle: handoff.title,
    sourceThroughItemId: items.at(-1)?.id ?? null,
    checkpoint,
    handoff: handoff.text,
    previewUser: preview?.user ?? null,
    previewAssistant: preview?.assistant ?? null,
    createdAt: Date.now()
  }
  return host.create(targetModel, targetEffort, continuation,
    sourceRecord ? { cwd: sourceRecord.cwd, projectPath: sourceRecord.projectPath } : undefined)
}

