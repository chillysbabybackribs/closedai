// Regex gate for when to attach host-verified workspace ledger context (pilot).

import { needsActiveBrowserContext } from '../turn-context.js'

const WORKSPACE_CONTEXT_CUES = [
  /\b(?:fix|implement|refactor|debug|patch|add|update|remove|migrate)\b/i,
  /\b(?:test:one|typecheck|unit test|run tests|npm test)\b/i,
  /\b(?:read-only|assess|review|audit)\b.{0,40}\b(?:code|repo|repository|module|helper|tests?)\b/i,
  /\b(?:continue|handoff|pick up|as before|previous chat)\b/i,
  /\bsrc\/[\w./-]+\.(?:ts|tsx|js|mjs|css|md|json)\b/i,
  /\b[\w.-]+\/[\w./-]+\.(?:ts|tsx|js|mjs)\b/i
] as const

const REPO_WORK_CUES = [
  /\b(?:repo|repository|codebase|code|module|helper|component|tests?|typecheck)\b/i,
  /\bsrc\/[\w./-]+\.(?:ts|tsx|js|mjs)\b/i,
  /\b(?:docs|scripts|harness)\/[\w./-]+\./i
] as const

/** True when attaching a bounded workspace ledger is likely worth the tokens. */
export function needsWorkspaceContext(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const browserOnly =
    needsActiveBrowserContext(trimmed) &&
    !REPO_WORK_CUES.some((cue) => cue.test(trimmed))
  if (browserOnly) return false
  return WORKSPACE_CONTEXT_CUES.some((cue) => cue.test(trimmed))
}

/** Path-shaped tokens from the user message; host still validates existence and hash. */
export function extractPathHints(text: string): string[] {
  const patterns = [
    /\bsrc\/[\w./-]+\.(?:ts|tsx|js|mjs|css|md|json)\b/g,
    /\b(?:docs|scripts|harness)\/[\w./-]+\.(?:ts|tsx|js|mjs|md|json)\b/g
  ]
  const paths = new Set<string>()
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) paths.add(match[0]!)
  }
  return [...paths]
}
