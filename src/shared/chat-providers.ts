import type { ChatProvider } from './chat.js'

// The one place that knows which backend an id belongs to. Every model id, thread id, and turn
// id the chat surface carries is routed by prefix: Claude ids carry `claude:`, Antigravity ids
// carry `agy:`, and Codex ids (app-server model names and thread UUIDs) never contain a colon.
// Main, preload, and renderer all route through here, and each provider's own `*-ids.ts` names
// its ids in that provider's vocabulary while delegating the prefix arithmetic to this file, so
// a new provider is one row per table below rather than a fourth copy of the same three helpers.

export const CHAT_PROVIDERS: readonly ChatProvider[] = ['codex', 'claude', 'antigravity', 'cursor']

/** How the pane names each provider. */
export const CHAT_PROVIDER_LABELS: Record<ChatProvider, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  antigravity: 'Antigravity',
  cursor: 'Cursor'
}

/** The prefix a provider's model and thread ids carry. Codex ids carry none and are the default. */
export const CHAT_PROVIDER_ID_PREFIXES: Record<ChatProvider, string> = {
  codex: '',
  claude: 'claude:',
  antigravity: 'agy:',
  cursor: 'cursor:'
}

/** The prefix a provider's sessions mint turn ids with. Codex turn ids carry none. */
export const CHAT_PROVIDER_TURN_PREFIXES: Record<ChatProvider, string> = {
  codex: '',
  claude: 'claude-turn-',
  antigravity: 'agy-turn-',
  cursor: 'cursor-turn-'
}

export function isChatProvider(value: unknown): value is ChatProvider {
  return typeof value === 'string' && (CHAT_PROVIDERS as readonly string[]).includes(value)
}

/** The provider behind a model id or thread id; ids without a known prefix are Codex. */
export function chatProviderOfId(id: string | null | undefined): ChatProvider {
  return providerByPrefix(CHAT_PROVIDER_ID_PREFIXES, id)
}

/** The provider behind a turn id; turn ids without a known prefix are Codex. */
export function chatProviderOfTurnId(turnId: string | null | undefined): ChatProvider {
  return providerByPrefix(CHAT_PROVIDER_TURN_PREFIXES, turnId)
}

/** A provider-native id (SDK session, CLI conversation, app-server thread) as the pane carries it. */
export function prefixChatId(provider: ChatProvider, value: string): string {
  return `${CHAT_PROVIDER_ID_PREFIXES[provider]}${value}`
}

/** Whether an id belongs to this provider. Codex owns every id no other provider claims. */
export function isChatIdOf(provider: ChatProvider, id: string | null | undefined): id is string {
  if (typeof id !== 'string' || id.length === 0) return false
  const prefix = CHAT_PROVIDER_ID_PREFIXES[provider]
  if (!prefix) return chatProviderOfId(id) === provider
  return id.startsWith(prefix) && id.length > prefix.length
}

/** The provider-native id behind a pane id, or null when the id belongs to another provider. */
export function bareChatId(provider: ChatProvider, id: string | null | undefined): string | null {
  if (!isChatIdOf(provider, id)) return null
  return id.slice(CHAT_PROVIDER_ID_PREFIXES[provider].length)
}

function providerByPrefix(
  prefixes: Record<ChatProvider, string>,
  id: string | null | undefined
): ChatProvider {
  if (typeof id !== 'string') return 'codex'
  for (const provider of CHAT_PROVIDERS) {
    const prefix = prefixes[provider]
    if (prefix && id.startsWith(prefix) && id.length > prefix.length) return provider
  }
  return 'codex'
}
