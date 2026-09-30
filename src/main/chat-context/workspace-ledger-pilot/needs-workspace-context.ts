// Regex gate for when to attach host-verified workspace ledger context (pilot).

const WORKSPACE_CONTEXT_CUES = [
  /\b(?:fix|implement|refactor|debug|patch|add|update|remove|migrate)\b/i,
  /\b(?:test:one|typecheck|unit test|run tests|npm test)\b/i,
  /\b(?:read-only|assess|review|audit)\b.{0,40}\b(?:code|repo|repository|module|helper|tests?)\b/i,
  /\b(?:continue|handoff|pick up|as before|previous chat)\b/i,
  /\bsrc\/[\w./-]+\.(?:ts|tsx|js|mjs|css|md|json)\b/i,
  /\b[\w.-]+\/[\w./-]+\.(?:ts|tsx|js|mjs)\b/i
] as const

/** True when attaching a bounded workspace ledger is likely worth the tokens. */
export function needsWorkspaceContext(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
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
