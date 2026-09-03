import type { AccountInfo, ModelInfo } from '@anthropic-ai/claude-agent-sdk'

// The model catalogue and the signed-in account belong to the Claude CLI and the account, not
// to one chat pane. Reading them costs a process spawn — about a second — and every new chat
// paid it before its composer would accept a message, even though the pane it was started from
// had just read the same answer. One workspace-wide entry, briefly cached, makes a fresh pane
// usable immediately; the first real turn still spawns the process that turn needs.

export type ClaudeCatalog = {
  models: ModelInfo[]
  account: AccountInfo | null
}

/** Short enough that signing in or out of the CLI is picked up without restarting the app. */
const CATALOG_TTL_MS = 10 * 60 * 1000

const entries = new Map<string, { at: number; catalog: ClaudeCatalog }>()

export function readClaudeCatalog(cwd: string, now = Date.now()): ClaudeCatalog | null {
  const entry = entries.get(cwd)
  if (!entry) return null
  if (now - entry.at > CATALOG_TTL_MS) {
    entries.delete(cwd)
    return null
  }
  return entry.catalog
}

/** Only a signed-in read is worth sharing: a signed-out one would outlive the sign-in that fixes it. */
export function rememberClaudeCatalog(cwd: string, catalog: ClaudeCatalog, now = Date.now()): void {
  if (!catalog.account) return
  entries.set(cwd, { at: now, catalog })
}

export function forgetClaudeCatalog(cwd?: string): void {
  if (cwd === undefined) entries.clear()
  else entries.delete(cwd)
}
