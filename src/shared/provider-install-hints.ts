import type { ChatProvider } from './chat.js'

/** One sentence when the provider CLI is missing on this machine. */
export const PROVIDER_INSTALL_HINTS: Record<ChatProvider, string> = {
  codex: 'Codex is not installed. Install the Codex CLI and sign in from the app, or choose another model.',
  claude: 'Claude Code could not start its bundled CLI. Reinstall ClosedAI, or choose another model.',
  antigravity: 'Antigravity is not installed. Install the Antigravity CLI (agy) and sign in with Google, or choose another model.',
  cursor: 'Cursor is not installed. Install the Cursor CLI (cursor-agent) and run `cursor-agent login`, or choose another model.'
}
