import type { ChatEvent, ChatSnapshot, ChatTranscriptItem } from '../shared/chat.js'

export function initialChatState(): ChatSnapshot {
  return {
    connection: { state: 'starting', message: 'Starting Codex…' },
    account: null,
    models: [],
    selectedModel: null,
    cwd: '',
    threadId: null,
    threadName: null,
    activeTurnId: null,
    contextUsage: null,
    items: []
  }
}

/** Header title: the app-server name, else the first user message, else a placeholder. */
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
        connection: event.connection,
        account: event.account,
        models: event.models,
        selectedModel: event.selectedModel
      }
    case 'model':
      return { ...state, selectedModel: event.selectedModel }
    case 'thread':
      return { ...state, threadId: event.threadId, threadName: event.threadName }
    case 'turn':
      return { ...state, activeTurnId: event.turnId }
    case 'context':
      return { ...state, contextUsage: event.usage }
    case 'item':
      return { ...state, items: upsertItem(state.items, event.item) }
    case 'itemDelta':
      return {
        ...state,
        items: state.items.map((item) => appendDelta(item, event.itemId, event.field, event.delta))
      }
  }
}

function upsertItem(items: ChatTranscriptItem[], next: ChatTranscriptItem): ChatTranscriptItem[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index < 0) return [...items, next]
  const copy = [...items]
  copy[index] = next
  return copy
}

function appendDelta(
  item: ChatTranscriptItem,
  itemId: string,
  field: 'text' | 'output',
  delta: string
): ChatTranscriptItem {
  if (item.id !== itemId) return item
  if (field === 'text' && (item.type === 'assistant' || item.type === 'plan' || item.type === 'reasoning')) {
    return { ...item, text: item.text + delta }
  }
  if (field === 'output' && item.type === 'command') return { ...item, output: item.output + delta }
  return item
}
