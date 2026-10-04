// Regex gate for when to attach host-verified workspace ledger context (pilot).

import { needsActiveBrowserContext } from '../turn-context.js'

const REPO_ANCHOR =
  /\b(?:bug|bugs|issue|issues|tests?|test:one|code|repo|repository|codebase|module|helper|component|function|file|files|settings|store|error|errors|failing|failure|src\/|\w[\w.-]*\/[\w./-]+\.(?:ts|tsx|js|mjs))\b/i

const WORKSPACE_CONTEXT_CUES = [
  /\b(?:implement|refactor|debug|patch|add|update|remove|migrate)\b/i,
  new RegExp(`\\bfix\\b.{0,64}${REPO_ANCHOR.source}`, 'i'),
  new RegExp(`${REPO_ANCHOR.source}.{0,64}\\bfix\\b`, 'i'),
  /\b(?:test:one|typecheck|unit test|run tests|npm test)\b/i,
  /\b(?:read-only|assess|review|audit)\b.{0,40}\b(?:code|repo|repository|module|helper|tests?)\b/i,
  /\b(?:continue|handoff|pick up|as before|previous chat)\b/i,
  /\bsrc\/[\w./-]+\.(?:ts|tsx|js|mjs|css|md|json)\b/i,
  /\b[\w.-]+\/[\w./-]+\.(?:ts|tsx|js|mjs)\b/i
] as const

const REPO_WORK_CUES = [
  /\b(?:repo|repository|codebase|code|module|helper|component|tests?|typecheck)\b/i,
  /\b(?:implement|refactor|debug|patch|fix|add|update|remove|migrate)\b/i,
  /\b(?:renderer|stylesheet|css|tsx|jsx|dropdown|scroll|overflow)\b/i,
  /\bsrc\/[\w./-]+\.(?:ts|tsx|js|mjs|css)\b/i,
  /\b(?:docs|scripts|harness)\/[\w./-]+\./i
] as const

/** Repo-style user intent; used to avoid browser-first tool slices on an open tab alone. */
export function promptLooksLikeRepoWork(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return REPO_WORK_CUES.some((cue) => cue.test(trimmed))
}

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
