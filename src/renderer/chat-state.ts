import type { ChatEvent, ChatProvider, ChatSnapshot, ChatTranscriptItem } from '../shared/chat.js'

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
    items: []
  }
}

/** How the pane names each provider. */
export const PROVIDER_LABELS: Record<ChatProvider, string> = { codex: 'Codex', claude: 'Claude Code' }

/** Header title: the provider's thread name, else the first user message, else a placeholder. */
export function chatTitle(state: ChatSnapshot): string {
  if (state.threadName) return state.threadName
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
    case 'item':
      return { ...state, items: upsertItem(state.items, event.item) }
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
