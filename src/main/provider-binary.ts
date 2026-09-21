import type { ChatProvider } from '../shared/chat.js'

// What every provider lane says when its executable is missing, and how a spawn failure is
// recognised as that. Node reports a missing binary as `spawn <name> ENOENT`; the one-shot CLI
// runners (agy, cursor-agent) rephrase it as "The <X> CLI (<path>) was not found" before the
// service sees it. Both read as "not installed" here, so a pane shows one install sentence
// instead of the raw error, and the Codex restart loop slows down instead of hammering.

export const CODEX_BINARY_ENV = 'CLOSEDAI_CODEX_PATH'

/** How often a lane re-probes for a binary that was missing; the user is installing, not waiting on us. */
export const MISSING_BINARY_RETRY_MS = 60_000

/** Shown on the connection (and as the availability hint) when the provider is not installed. */
export const PROVIDER_INSTALL_HINTS: Record<ChatProvider, string> = {
  codex: 'Codex is not installed. Install the Codex CLI and sign in from the app, or choose another model.',
  claude: 'Claude Code could not start its bundled CLI. Reinstall ClosedAI, or choose another model.',
  antigravity: 'Antigravity is not installed. Install the Antigravity CLI (agy) and sign in with Google, or choose another model.',
  cursor: 'Cursor is not installed. Install the Cursor CLI (cursor-agent) and run `cursor-agent login`, or choose another model.'
}

/** The availability hint once the provider is installed: what remains is signing in. */
export const PROVIDER_SIGN_IN_HINTS: Record<ChatProvider, string> = {
  codex: 'Codex is installed. Sign in with ChatGPT from a Codex chat when prompted.',
  claude: 'Claude Code is bundled with the app. Sign in from a Claude chat when prompted.',
  antigravity: 'Antigravity is installed. Run `agy` in a terminal and complete the Google login if a chat asks you to sign in.',
  cursor: 'Cursor is installed. Run `cursor-agent login` in a terminal if a chat asks you to sign in.'
}

export function missingProviderMessage(provider: ChatProvider): string {
  return PROVIDER_INSTALL_HINTS[provider]
}

/** True when a start failure means the executable is absent rather than broken or signed out. */
export function isMissingExecutable(error: unknown): boolean {
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT') return true
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /\bENOENT\b/.test(message) || /CLI \([^)]*\) was not found/.test(message)
}
