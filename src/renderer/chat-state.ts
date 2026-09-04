import type { ChatEvent, ChatHistoryPage, ChatProvider, ChatSnapshot, ChatTranscriptItem } from '../shared/chat.js'
import type { ChatWorkspaceEvent, ChatWorkspaceSnapshot } from '../shared/chat-peers.js'
import { CHAT_PROVIDER_LABELS } from '../shared/chat-providers.js'
import { activityPhase } from '../shared/chat.js'

export function initialChatState(): ChatSnapshot {
  return {
    provider: 'codex',
    connection: { state: 'starting', message: 'Starting Codex…' },
    account: null,
    models: [],
    selectedModel: null,
    selectedReasoningEffort: null,
    cwd: '',
    threadId: null,
    threadName: null,
    activeTurnId: null,
    contextUsage: null,
    planUsage: null,
    turnContext: null,
    items: []
  }
}

export function initialChatWorkspaceState(): ChatWorkspaceSnapshot {
  return { selectedPaneId: '', chats: [], selected: initialChatState() }
}

export type ChatWorkspaceAction = ChatWorkspaceEvent | {
  type: 'historyPage'; paneId: string; threadId: string | null; beforeItemId: string; page: ChatHistoryPage
}

export function reduceChatWorkspaceEvent(
  state: ChatWorkspaceSnapshot,
  event: ChatWorkspaceAction
): ChatWorkspaceSnapshot {
  if (event.type === 'historyPage') {
    if (event.paneId !== state.selectedPaneId || event.threadId !== state.selected.threadId ||
      event.beforeItemId !== state.selected.items[0]?.id) return state
    const existing = new Set(state.selected.items.map((item) => item.id))
    const retained = new Map(state.selected.history?.backgroundTasks?.map((item) => [item.id, item]))
    const earlier = event.page.items.filter((item) => !existing.has(item.id)).map((item) => retained.get(item.id) ?? item)
    const loaded = new Set(earlier.map((item) => item.id))
    return { ...state, selected: { ...state.selected,
      items: [...earlier, ...state.selected.items],
      history: { ...state.selected.history, hasEarlier: event.page.hasEarlier,
        backgroundTasks: [...retained.values()].filter((item) => !loaded.has(item.id)) }
    } }
  }
  if (event.type === 'workspace') return event.snapshot
  if (event.type === 'chats') {
    return { ...state, selectedPaneId: event.selectedPaneId, chats: event.chats }
  }
  if (event.paneId !== state.selectedPaneId) return state
  return { ...state, selected: reduceChatEvent(state.selected, event.event) }
}

/** How the pane names each provider. */
export const PROVIDER_LABELS: Record<ChatProvider, string> = CHAT_PROVIDER_LABELS

/** Header title: the provider's thread name, else the first user message, else a placeholder. */
export function chatTitle(state: ChatSnapshot): string {
  if (state.threadName) return state.threadName
  if (state.history?.hasEarlier && state.history.title) return state.history.title
  const first = state.items.find((item) => item.type === 'user')
  if (first && first.type === 'user') {
    return first.text.trim() ? summarizeMessage(first.text) : first.attachments?.[0]?.name ?? 'New chat'
  }
  return 'New chat'
}

export function summarizeMessage(text: string, max = 60): string {
  const line = text.trim().split('\n')[0]?.trim() ?? ''
  if (!line) return 'New chat'
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

export function reduceChatEvent(state: ChatSnapshot, event: ChatEvent): ChatSnapshot {
  switch (event.type) {
    case 'replace':
      return event.snapshot
    case 'connection':
      return {
        ...state,
        provider: event.provider,
        connection: event.connection,
        account: event.account,
        models: event.models,
        selectedModel: event.selectedModel,
        selectedReasoningEffort: event.selectedReasoningEffort
      }
    case 'model':
      return { ...state, selectedModel: event.selectedModel, selectedReasoningEffort: event.selectedReasoningEffort }
    case 'reasoningEffort':
      return { ...state, selectedReasoningEffort: event.selectedReasoningEffort }
    case 'thread':
      return { ...state, threadId: event.threadId, threadName: event.threadName }
    case 'turn':
      return { ...state, activeTurnId: event.turnId }
    case 'context':
      return { ...state, contextUsage: event.usage }
    case 'planUsage':
      return { ...state, planUsage: event.usage }
    case 'turnContext':
      return { ...state, turnContext: event.report }
    case 'item': {
      if (state.history?.hasEarlier && event.appended === false && !state.items.some((item) => item.id === event.item.id)) {
        if (event.item.type !== 'tool' || !event.item.background) return state
        return { ...state, history: { ...state.history,
          backgroundTasks: upsertItem(state.history.backgroundTasks ?? [], event.item) } }
      }
      if (event.item.type === 'user' && event.appended !== false && state.history?.backgroundTasks?.length) {
        state = { ...state, history: { ...state.history, backgroundTasks: state.history.backgroundTasks.filter((item) =>
          item.type === 'tool' && ['running', 'pending'].includes(activityPhase(item.status))) } }
      }
      return { ...state, items: upsertItem(state.items, event.item) }
    }
    case 'itemDelta': {
      const index = state.items.findIndex((item) => item.id === event.itemId)
      if (index < 0) return state
      const updated = appendDelta(state.items[index]!, event.field, event.delta)
      if (updated === state.items[index]) return state
      const items = [...state.items]
      items[index] = updated
      return { ...state, items }
    }
  }
}

/**
 * Merge a burst of events into the fewest equivalent ones. Streaming sends one `itemDelta`
 * per token chunk; adjacent deltas for the same item and field collapse into one, and any
 * `replace` discards everything before it, so a frame's worth of chunks costs one reduce.
 */
export function coalesceChatEvents(events: ChatEvent[]): ChatEvent[] {
  const merged: ChatEvent[] = []
  for (const event of events) {
    if (event.type === 'replace') {
      merged.length = 0
      merged.push(event)
      continue
    }
    const last = merged[merged.length - 1]
    if (
      event.type === 'itemDelta' && last?.type === 'itemDelta' &&
      last.itemId === event.itemId && last.field === event.field
    ) {
      merged[merged.length - 1] = { ...last, delta: last.delta + event.delta }
      continue
    }
    merged.push(event)
  }
  return merged
}

/**
 * Merge a burst of workspace events. Streaming chunks for the same pane collapse
 * their inner itemDeltas, and any full workspace snapshot drops prior queued events.
 */
export function coalesceChatWorkspaceEvents(events: ChatWorkspaceEvent[]): ChatWorkspaceEvent[] {
  const merged: ChatWorkspaceEvent[] = []
  for (const event of events) {
    if (event.type === 'workspace') {
      merged.length = 0
      merged.push(event)
      continue
    }
    const last = merged[merged.length - 1]
    if (
      event.type === 'pane' &&
      last?.type === 'pane' &&
      last.paneId === event.paneId
    ) {
      const coalesced = coalesceChatEvents([last.event, event.event])
      if (coalesced.length === 1) {
        merged[merged.length - 1] = { type: 'pane', paneId: event.paneId, event: coalesced[0]! }
        continue
      }
    }
    merged.push(event)
  }
  return merged
}

function upsertItem(items: ChatTranscriptItem[], next: ChatTranscriptItem): ChatTranscriptItem[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index < 0) return [...items, next]
  const copy = [...items]
  copy[index] = next
  return copy
}

function appendDelta(item: ChatTranscriptItem, field: 'text' | 'output', delta: string): ChatTranscriptItem {
  if (field === 'text' && (item.type === 'assistant' || item.type === 'plan' || item.type === 'reasoning')) {
    return { ...item, text: item.text + delta }
  }
  if (field === 'output' && item.type === 'command') return { ...item, output: item.output + delta }
  return item
}
