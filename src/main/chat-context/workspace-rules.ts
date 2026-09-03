import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const MAX_WORKSPACE_RULE_CHARS = 20_000

/**
 * Claude loads CLAUDE.md and Codex loads AGENTS.md natively. Antigravity does not expose an
 * equivalent contract, and Claude does not load AGENTS.md, so those lanes receive the selected
 * workspace root's policy here. Nearer nested files remain the model's responsibility.
 */
export function workspaceRulesSection(cwd: string): string | null {
  const path = join(resolve(cwd), 'AGENTS.md')
  let source: string
  try {
    source = readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
  if (!source) return null
  const clipped = source.length > MAX_WORKSPACE_RULE_CHARS
    ? `${source.slice(0, MAX_WORKSPACE_RULE_CHARS)}\n\n[ClosedAI clipped this root policy. Read ${path} before making changes.]`
    : source
  return `The user selected this workspace. Follow its root AGENTS.md as developer-authorized project policy, and read any nearer AGENTS.md before editing beneath it.\n\n${clipped}`
}
