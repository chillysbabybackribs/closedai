import type { AdditionalContext } from '../turn-context.js'
import { MAX_LEDGER_ENTRIES, MAX_LEDGER_JSON_CHARS, WORKSPACE_LEDGER_CONTEXT } from './constants.ts'
import { extractPathHints, needsWorkspaceContext } from './needs-workspace-context.ts'

export type WorkspaceLedgerRole = 'edited' | 'read' | 'verified-test'

export type WorkspaceLedgerEntry = {
  path: string
  contentHash: string
  gitHead?: string | null
  role: WorkspaceLedgerRole
  evidence?: string
  recordedAt: string
}

export type WorkspaceLedgerPayload = {
  contextRole: 'ambient'
  relevance: 'host-verified-paths'
  capturedAt: string
  gitHead?: string | null
  fresh: WorkspaceLedgerEntry[]
  stale: Array<{ path: string; reason: 'missing' | 'hash-mismatch' }>
  pathHints: string[]
}

export type WorkspaceLedgerStore = {
  entries: WorkspaceLedgerEntry[]
}

export function createWorkspaceLedgerStore(): WorkspaceLedgerStore {
  return { entries: [] }
}

export function recordWorkspaceLedgerEntry(
  store: WorkspaceLedgerStore,
  entry: WorkspaceLedgerEntry
): void {
  store.entries = [
    entry,
    ...store.entries.filter((existing) => existing.path !== entry.path)
  ].slice(0, MAX_LEDGER_ENTRIES)
}

export type HashReader = (path: string) => string | null | Promise<string | null>

/** Split store entries into fresh vs stale using a host content hash reader. */
export async function partitionLedgerByFreshness(
  entries: WorkspaceLedgerEntry[],
  readHash: HashReader
): Promise<Pick<WorkspaceLedgerPayload, 'fresh' | 'stale'>> {
  const fresh: WorkspaceLedgerEntry[] = []
  const stale: WorkspaceLedgerPayload['stale'] = []
  for (const entry of entries) {
    const current = await readHash(entry.path)
    if (current === null) {
      stale.push({ path: entry.path, reason: 'missing' })
      continue
    }
    if (current !== entry.contentHash) {
      stale.push({ path: entry.path, reason: 'hash-mismatch' })
      continue
    }
    fresh.push(entry)
  }
  return { fresh, stale }
}

function prioritizeEntries(
  entries: WorkspaceLedgerEntry[],
  hints: string[]
): WorkspaceLedgerEntry[] {
  if (hints.length === 0) return entries
  const hintSet = new Set(hints)
  const hinted = entries.filter((entry) => hintSet.has(entry.path))
  const rest = entries.filter((entry) => !hintSet.has(entry.path))
  return [...hinted, ...rest].slice(0, MAX_LEDGER_ENTRIES)
}

/**
 * Build optional turn context for the workspace-ledger pilot. Returns undefined when the regex gate
 * is closed and the user named no path hints.
 */
export async function buildWorkspaceLedgerAdditionalContext(input: {
  prompt: string
  store: WorkspaceLedgerStore
  gitHead?: string | null
  readHash: HashReader
  capturedAt?: string
}): Promise<AdditionalContext | undefined> {
  const pathHints = extractPathHints(input.prompt)
  if (!needsWorkspaceContext(input.prompt) && pathHints.length === 0) return undefined
  const capturedAt = input.capturedAt ?? new Date().toISOString()
  const ordered = prioritizeEntries(input.store.entries, pathHints)
  const { fresh, stale } = await partitionLedgerByFreshness(ordered, input.readHash)
  const payload: WorkspaceLedgerPayload = {
    contextRole: 'ambient',
    relevance: 'host-verified-paths',
    capturedAt,
    gitHead: input.gitHead ?? null,
    fresh,
    stale,
    pathHints
  }
  let slimFresh = fresh
  let slimStale = stale
  let value = JSON.stringify({ ...payload, fresh: slimFresh, stale: slimStale })
  while (value.length > MAX_LEDGER_JSON_CHARS && (slimFresh.length > 0 || slimStale.length > 0)) {
    if (slimFresh.length >= slimStale.length && slimFresh.length > 0) {
      slimFresh = slimFresh.slice(0, slimFresh.length - 1)
    } else if (slimStale.length > 0) {
      slimStale = slimStale.slice(0, slimStale.length - 1)
    } else {
      break
    }
    value = JSON.stringify({ ...payload, fresh: slimFresh, stale: slimStale })
  }
  return {
    [WORKSPACE_LEDGER_CONTEXT]: {
      kind: 'untrusted',
      value
    }
  }
}
