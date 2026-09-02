import type { ChatProvider } from './chat.js'

// The one place that knows which backend an id belongs to. Every model id and thread id the
// chat surface carries is routed by prefix: Claude ids carry `claude:`, Antigravity ids carry
// `agy:`, and Codex ids (app-server model names and thread UUIDs) never contain a colon.
// Main, preload, and renderer all route through here so a new provider is one entry.

export const CHAT_PROVIDERS: readonly ChatProvider[] = ['codex', 'claude', 'antigravity']

/** How the pane names each provider. */
export const CHAT_PROVIDER_LABELS: Record<ChatProvider, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  antigravity: 'Antigravity'
}

const PREFIXES: ReadonlyArray<[prefix: string, provider: ChatProvider]> = [
  ['claude:', 'claude'],
  ['agy:', 'antigravity']
]

/** The provider behind a model id or thread id; ids without a known prefix are Codex. */
export function chatProviderOfId(id: string | null | undefined): ChatProvider {
  if (typeof id !== 'string') return 'codex'
  for (const [prefix, provider] of PREFIXES) {
    if (id.startsWith(prefix) && id.length > prefix.length) return provider
  }
  return 'codex'
}
