import { resolve } from 'node:path'
import type { HookCallbackMatcher, HookInput, HookJSONOutput, Options } from '@anthropic-ai/claude-agent-sdk'
import { readFileSnapshot, type FileSnapshot } from '../tools/file-snapshot.js'

// Only native Read responses whose actual text matches a current snapshot are credited.
// Shell output and searches cannot prove delivered ranges, so they are never suppressed.
// Fresh hashes catch other panes and external edits; context availability is tracked separately.
export type LineRange = { start: number; end: number }
export type LedgerVerdict =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'narrow'; input: Record<string, unknown>; note: string }
export type LedgerSkip = { tool: string; path: string; lines: number; verdict: 'deny' | 'narrow' }
type ReadVersion = { hash: string; ranges: LineRange[] }
type Scope = Map<string, ReadVersion>
type ReadReceipt = { path: string; hash: string; startLine: number; endLine: number; previousRangesInvalidated?: true }

const VOLATILE_PATH = /(?:^|\/)(?:node_modules|out|dist|build|coverage|\.git)\/|\.(?:log|out|output|jsonl|pid|lock|tmp)$/

export class ClaudeReadLedger {
  private readonly scopes = new Map<string, Scope>()

  constructor(private readonly onSkip?: (skip: LedgerSkip) => void) {}

  /** Context availability is uncertain after a new turn, compaction, or session replacement. */
  reset(): void { this.scopes.clear() }

  async before(scope: string, tool: string, input: unknown, cwd: string): Promise<LedgerVerdict> {
    if (tool !== 'Read') return { kind: 'allow' }
    const state = this.scope(scope)
    const args = record(input)
    const snapshot = await snapshotFor(args, cwd)
    if (!snapshot || this.scopes.get(scope) !== state) return { kind: 'allow' }
    const prior = state.get(snapshot.path)
    if (!prior) return { kind: 'allow' }
    if (prior.hash !== snapshot.hash) {
      state.delete(snapshot.path)
      return { kind: 'allow' }
    }
    const start = positiveInteger(args.offset) ?? 1
    const count = positiveInteger(args.limit)
    const end = Math.min(count === null ? snapshot.lines.length : start + count - 1, snapshot.lines.length)
    if (start > end) return { kind: 'allow' }
    const wanted = { start, end }
    const missing = subtract(wanted, prior.ranges)
    if (!missing.length) {
      this.onSkip?.({ tool, path: snapshot.path, lines: end - start + 1, verdict: 'deny' })
      return { kind: 'deny', reason: snapshot.path + ' lines ' + start + '-' + end +
        ' already returned earlier this turn; ' + snapshot.hash + ' is unchanged at this check. Reuse those lines.' }
    }
    if (missing.length !== 1 || missing[0]!.end - missing[0]!.start === end - start) return { kind: 'allow' }
    const gap = missing[0]!
    this.onSkip?.({ tool, path: snapshot.path, lines: end - start - (gap.end - gap.start), verdict: 'narrow' })
    return {
      kind: 'narrow', input: { ...args, offset: gap.start, limit: gap.end - gap.start + 1 },
      note: 'Returning only missing lines ' + gap.start + '-' + gap.end +
        '; other requested lines were already returned this turn. ' + snapshot.hash + ' is unchanged at this check.'
    }
  }

  /** A post-read disk hash alone is insufficient: match the delivered text to that snapshot. */
  async after(scope: string, tool: string, input: unknown, response: unknown, cwd: string): Promise<ReadReceipt | null> {
    if (tool !== 'Read') return null
    const state = this.scope(scope)
    const result = record(response)
    const file = record(result.file)
    const start = positiveInteger(file.startLine)
    const count = positiveInteger(file.numLines)
    if (result.isError || typeof file.content !== 'string' || start === null || count === null) return null
    const snapshot = await snapshotFor(record(input), cwd)
    if (!snapshot || this.scopes.get(scope) !== state) return null
    const end = start + count - 1
    if (end > snapshot.lines.length || file.totalLines !== snapshot.lines.length) return null
    const expected = snapshot.lines.slice(start - 1, end).join('\n')
    if (normalize(file.content) !== normalize(expected)) {
      state.delete(snapshot.path)
      return null
    }
    const prior = state.get(snapshot.path)
    const ranges = prior?.hash === snapshot.hash ? prior.ranges : []
    state.set(snapshot.path, { hash: snapshot.hash, ranges: merge([...ranges, { start, end }]) })
    return {
      path: snapshot.path, hash: snapshot.hash, startLine: start, endLine: end,
      ...(prior && prior.hash !== snapshot.hash ? { previousRangesInvalidated: true as const } : {})
    }
  }

  hooks(): NonNullable<Options['hooks']> {
    const matcher = (hook: (input: HookInput) => Promise<HookJSONOutput> | HookJSONOutput): HookCallbackMatcher[] =>
      [{ hooks: [async (input) => hook(input)] }]
    return {
      PreToolUse: matcher(async (input) => {
        if (input.hook_event_name !== 'PreToolUse') return {}
        const verdict = await this.before(scopeOf(input), input.tool_name, input.tool_input, input.cwd)
        if (verdict.kind === 'deny') return { hookSpecificOutput: {
          hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason
        } }
        if (verdict.kind === 'narrow') return { hookSpecificOutput: {
          hookEventName: 'PreToolUse', updatedInput: verdict.input, additionalContext: verdict.note
        } }
        return {}
      }),
      PostToolUse: matcher(async (input) => {
        if (input.hook_event_name !== 'PostToolUse') return {}
        const receipt = await this.after(scopeOf(input), input.tool_name, input.tool_input, input.tool_response, input.cwd)
        if (!receipt) return {}
        return { hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput: { ...record(input.tool_response), closedai_read: receipt }
        } }
      }),
      UserPromptSubmit: matcher(() => { this.reset(); return {} }),
      PreCompact: matcher((input) => { this.scopes.delete(scopeOf(input)); return {} }),
      SubagentStop: matcher((input) => { this.scopes.delete(scopeOf(input)); return {} })
    }
  }

  private scope(id: string): Scope {
    let state = this.scopes.get(id)
    if (!state) { state = new Map(); this.scopes.set(id, state) }
    return state
  }
}

async function snapshotFor(args: Record<string, unknown>, cwd: string): Promise<FileSnapshot | null> {
  if (typeof args.file_path !== 'string' || !args.file_path) return null
  try {
    const snapshot = await readFileSnapshot(resolve(cwd, args.file_path))
    const root = resolve(cwd)
    return snapshot.path.startsWith(root + '/') && !VOLATILE_PATH.test(snapshot.path) ? snapshot : null
  } catch { return null }
}

function normalize(text: string): string { return text.replaceAll('\r\n', '\n').replace(/\n$/, '') }
function scopeOf(input: HookInput): string {
  return 'agent_id' in input && typeof input.agent_id === 'string' && input.agent_id ? input.agent_id : 'main'
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null
}

/** Sorted, coalesced ranges (touching ranges join). */
export function merge(ranges: readonly LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: LineRange[] = []
  for (const range of sorted) {
    const last = out.at(-1)
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end)
    else out.push({ ...range })
  }
  return out
}

export function subtract(wanted: LineRange, seen: readonly LineRange[]): LineRange[] {
  const gaps: LineRange[] = []
  let cursor = wanted.start
  for (const range of merge(seen)) {
    if (range.end < cursor) continue
    if (range.start > wanted.end) break
    if (range.start > cursor) gaps.push({ start: cursor, end: range.start - 1 })
    cursor = Math.max(cursor, range.end + 1)
  }
  if (cursor <= wanted.end && cursor !== Number.POSITIVE_INFINITY) gaps.push({ start: cursor, end: wanted.end })
  return gaps
}
