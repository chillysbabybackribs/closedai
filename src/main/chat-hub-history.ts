import type { ChatHistoryWindow, ChatSnapshot, ChatThreadContent } from '../shared/chat.js'
import type { AppSettings } from '../shared/types.js'
import type { CarriedHistory } from './chat-hub-provider-switch.js'
import { ChatTranscript } from './chat-transcript.js'

/** Display history survives provider rotation without resuming the retired model context. */
export async function restoreHubHistory(
  saved: AppSettings,
  read: (threadId: string, cwd?: string) => Promise<ChatThreadContent>
): Promise<ChatThreadContent | null> {
  const source = saved.chatContinuation
  if (!source && !saved.chatThreadId && !saved.chatClaudeSessionId &&
      !saved.chatAntigravityConversationId && !saved.chatCursorSessionId) return null
  const sources = new Map<string, { through: string | null; cwd?: string }>()
  if (source?.sourceCwd && source.sourceThreadId) {
    sources.set(source.sourceThreadId, { through: source.sourceThroughItemId ?? null, cwd: source.sourceCwd })
  }
  for (const rotation of saved.chatSessionRotations ?? []) {
    if (rotation.providerThreadId) sources.set(rotation.providerThreadId, { through: rotation.sourceThroughItemId })
  }
  const entries = [...sources]
  const results = await Promise.allSettled(entries.map(async ([threadId, boundary]) => {
    const history = await read(threadId, boundary.cwd)
    const end = boundary.through ? history.items.findIndex((item) => item.id === boundary.through) : -1
    // Runtime notices are not always stored by the provider. The retired thread itself is
    // still useful when its final notice cannot be found; directory moves stay strictly bounded.
    if (end < 0 && boundary.cwd) return null
    return { ...history, items: end < 0 ? history.items : history.items.slice(0, end + 1) }
  }))
  const items = new Map<string, ChatSnapshot['items'][number]>()
  let latest: ChatThreadContent | null = null
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[chat] could not restore retained transcript:', result.reason)
      continue
    }
    if (!result.value) continue
    latest = result.value
    for (const item of latest.items) items.set(item.id, item)
  }
  return latest ? { ...latest, items: [...items.values()] } : null
}

/** Page the whole visible conversation, including cursors in a retired provider thread. */
export function withHubHistory(snapshot: ChatSnapshot, carried: CarriedHistory | null, window?: ChatHistoryWindow): ChatSnapshot {
  if (!carried || carried.provider !== snapshot.provider) return snapshot
  const transcript = new ChatTranscript(snapshot.cwd, () => null, () => {})
  for (const item of [...carried.items, ...snapshot.items]) transcript.upsert(item)
  const page = window ? transcript.page(window) : null
  return {
    ...snapshot,
    threadName: snapshot.threadName ?? carried.threadName,
    items: page?.items ?? transcript.snapshot(),
    ...(page ? { history: { ...snapshot.history, hasEarlier: page.hasEarlier, backgroundTasks: page.backgroundTasks } } : {})
  }
}
