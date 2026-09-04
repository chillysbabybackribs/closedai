import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const MAX_WORKSPACE_RULE_CHARS = 20_000
const NESTED_RULE_DEPTH = 4
const NESTED_RULE_DIRS = 400
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'build', 'coverage', '.cache', '.next', 'target', 'vendor'])

/**
 * Nested AGENTS.md files below the workspace root, as workspace-relative paths. Measured
 * 2026-09-03: told merely to "read any nearer AGENTS.md", Codex hunted for one with `rg --files`
 * in 44 of 120 threads of a repository that has none. Listing the files (or their absence) as a
 * fact costs one bounded directory walk here and no model pass.
 */
export function nestedWorkspaceRuleFiles(cwd: string): string[] {
  const root = resolve(cwd)
  const found: string[] = []
  let visited = 0
  const walk = (directory: string, depth: number): void => {
    if (depth > NESTED_RULE_DEPTH || visited++ > NESTED_RULE_DIRS) return
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'AGENTS.md' && directory !== root) found.push(relative(root, join(directory, entry.name)))
      else if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(join(directory, entry.name), depth + 1)
    }
  }
  walk(root, 0)
  return found.sort()
}

/** One sentence settling whether nearer rule files exist, so no lane searches for them. */
export function nestedWorkspaceRulesNote(cwd: string): string {
  const files = nestedWorkspaceRuleFiles(cwd)
  if (files.length === 0) return 'There are no nested AGENTS.md files below the root; do not search for any.'
  return `Nested AGENTS.md files (read the nearest before editing beneath it; there are no others): ${files.join(', ')}.`
}

/**
 * Claude loads CLAUDE.md and Codex loads AGENTS.md natively. Antigravity does not expose an
 * equivalent contract, and Claude does not load AGENTS.md, so those lanes receive the selected
 * workspace root's policy here, with the nested files named rather than left to a search.
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
  return `The user selected this workspace. Follow its root AGENTS.md as developer-authorized project policy. ${nestedWorkspaceRulesNote(cwd)}\n\n${clipped}`
}
