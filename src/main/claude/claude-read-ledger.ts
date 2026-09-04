import { isAbsolute, resolve } from 'node:path'
import type { HookCallbackMatcher, HookInput, HookJSONOutput, Options } from '@anthropic-ai/claude-agent-sdk'

// Measured 2026-09-03 over the app's Claude panes: one read in five returned lines that were
// already in the turn's context (the same file re-sliced with overlapping ranges), and one
// search in fifteen repeated an identical earlier query. Instructions did not move that number,
// so the Claude lane enforces it: a PreToolUse hook denies a read whose lines were returned
// earlier this turn, narrows one that only partly overlaps to the missing lines, and denies a
// search identical to one already answered. Anything that can change the tree (an edit, a
// write, a shell command that is not a pure read) forgets what it could have invalidated, and a
// new turn or a compaction forgets everything, because the earlier copy is then gone too.

export type LineRange = { start: number; end: number }

export type LedgerVerdict =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'narrow'; input: Record<string, unknown>; note: string }

export type LedgerSkip = {
  tool: string
  path: string
  /** Lines the model asked for again; for a narrowed read, the lines left out. */
  lines: number
  verdict: 'deny' | 'narrow'
}

type Scope = {
  files: Map<string, LineRange[]>
  totals: Map<string, number>
  /** Identical Grep/Glob inputs and identical pure text-search shell commands already answered. */
  searches: Set<string>
}

const WHOLE = Number.POSITIVE_INFINITY
const SEARCH_TOOLS = new Set(['Grep', 'Glob'])
const EDIT_TOOLS: Record<string, string> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path'
}

// Commands whose only effect is output. A `git` segment counts only with a read-only verb;
// `sed` only when printing (`-n`) and not editing in place; a redirection anywhere is a write.
const READ_COMMANDS = new Set(['cat', 'head', 'tail', 'nl', 'wc', 'rg', 'grep', 'ugrep', 'ls', 'find', 'fd', 'tree',
  'echo', 'printf', 'pwd', 'stat', 'file', 'jq', 'sort', 'uniq', 'cut', 'tr', 'awk', 'diff', 'realpath', 'basename', 'dirname', 'which', 'type', 'test', 'true'])
const READ_GIT_VERBS = new Set(['status', 'diff', 'log', 'show', 'blame', 'ls-files', 'rev-parse', 'branch', 'grep'])
const TEXT_SEARCHES = new Set(['rg', 'grep', 'ugrep', 'fd'])
// Only source under the workspace is ledgered: a task log, a build product, or anything outside
// the checkout can change between reads, and re-reading it (polling) is the point.
const VOLATILE_PATH = /(?:^|\/)(?:node_modules|out|dist|build|coverage|\.git)\/|\.(?:log|out|output|jsonl|pid|lock|tmp)$/
const TREE_CHANGERS = /\bgit\s+(?:checkout|switch|stash|reset|apply|pull|merge|rebase|restore|clean)\b|\b(?:mv|rm|cp|tee|patch|apply_patch)\b|\bsed\s+-[a-zA-Z]*i|\bperl\s+-[a-zA-Z]*i|--write\b|\bnpm\s+run\s+map\b/

export class ClaudeReadLedger {
  private readonly scopes = new Map<string, Scope>()

  constructor(private readonly onSkip?: (skip: LedgerSkip) => void) {}

  /** Forget every scope: a new turn or a compaction has removed the earlier copies. */
  reset(): void {
    this.scopes.clear()
  }

  /** Decide a tool call before it runs. `cwd` resolves relative shell paths. */
  before(scope: string, tool: string, input: unknown, cwd: string): LedgerVerdict {
    const state = this.scope(scope)
    const args = record(input)
    if (tool === 'Read') return this.beforeRead(state, args)
    if (tool === 'Bash') return this.beforeBash(state, args, cwd)
    if (SEARCH_TOOLS.has(tool)) {
      const key = searchKey(tool, args)
      if (state.searches.has(key)) {
        this.onSkip?.({ tool, path: String(args.pattern ?? ''), lines: 0, verdict: 'deny' })
        return { kind: 'deny', reason: `This exact ${tool} was already answered earlier in this turn and nothing has been edited since; reuse that result or change the query.` }
      }
      return { kind: 'allow' }
    }
    const pathField = EDIT_TOOLS[tool]
    if (pathField) {
      const path = String(args[pathField] ?? '')
      if (path) this.forget(state, resolve(cwd, path))
      state.searches.clear()
    }
    return { kind: 'allow' }
  }

  /** Record what a successful tool call returned. */
  after(scope: string, tool: string, input: unknown, response: unknown, cwd: string): void {
    const state = this.scope(scope)
    const args = record(input)
    if (tool === 'Read') {
      const path = args.file_path ? resolve(String(args.file_path)) : ''
      if (!path || !ledgered(path, cwd)) return
      const file = record(record(response).file)
      const total = numberOf(file.totalLines)
      if (total !== null) state.totals.set(path, total)
      const start = numberOf(file.startLine) ?? numberOf(args.offset) ?? 1
      const count = numberOf(file.numLines) ?? numberOf(args.limit)
      this.remember(state, path, { start, end: count === null ? total ?? WHOLE : start + count - 1 })
      return
    }
    if (tool === 'Bash') {
      const command = String(args.command ?? '')
      const parsed = parseShell(command, cwd)
      if (!parsed.pureRead) return
      for (const read of parsed.reads) if (ledgered(read.path, cwd)) this.remember(state, read.path, read.range)
      if (parsed.textSearch && parsed.reads.length === 0) state.searches.add(`Bash ${command.trim()}`)
      return
    }
    if (SEARCH_TOOLS.has(tool)) state.searches.add(searchKey(tool, args))
  }

  /** The SDK hook set that applies this ledger to one Claude Code session. */
  hooks(): NonNullable<Options['hooks']> {
    const matcher = (hook: (input: HookInput) => HookJSONOutput): HookCallbackMatcher[] => [{ hooks: [async (input) => hook(input)] }]
    return {
      PreToolUse: matcher((input) => {
        if (input.hook_event_name !== 'PreToolUse') return {}
        const verdict = this.before(scopeOf(input), input.tool_name, input.tool_input, input.cwd)
        if (verdict.kind === 'deny') {
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason } }
        }
        if (verdict.kind === 'narrow') {
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: verdict.input, additionalContext: verdict.note } }
        }
        return {}
      }),
      PostToolUse: matcher((input) => {
        if (input.hook_event_name === 'PostToolUse') this.after(scopeOf(input), input.tool_name, input.tool_input, input.tool_response, input.cwd)
        return {}
      }),
      UserPromptSubmit: matcher(() => { this.reset(); return {} }),
      PreCompact: matcher((input) => { this.scopes.delete(scopeOf(input)); return {} }),
      SubagentStop: matcher((input) => { this.scopes.delete(scopeOf(input)); return {} })
    }
  }

  private beforeRead(state: Scope, args: Record<string, unknown>): LedgerVerdict {
    const path = args.file_path ? resolve(String(args.file_path)) : ''
    const seen = state.files.get(path)
    if (!path || !seen) return { kind: 'allow' }
    const total = state.totals.get(path) ?? WHOLE
    const offset = numberOf(args.offset) ?? 1
    const limit = numberOf(args.limit)
    const wanted = { start: offset, end: Math.min(limit === null ? WHOLE : offset + limit - 1, total) }
    const missing = subtract(wanted, seen)
    if (missing.length === 0) {
      this.onSkip?.({ tool: 'Read', path, lines: span(wanted), verdict: 'deny' })
      return { kind: 'deny', reason: `${describe(path, wanted, total)} already returned earlier in this turn, and the file has not changed since. Use that copy, or read lines outside it.` }
    }
    if (missing.length !== 1 || span(missing[0]!) >= span(wanted)) return { kind: 'allow' }
    const gap = missing[0]!
    const omitted = subtract(wanted, [gap])
    const input: Record<string, unknown> = { ...args, offset: gap.start }
    delete input.limit
    if (gap.end !== WHOLE) input.limit = gap.end - gap.start + 1
    this.onSkip?.({ tool: 'Read', path, lines: omitted.reduce((sum, range) => sum + span(range), 0), verdict: 'narrow' })
    const note = `${describe(path, omitted, total)} left out of this read: those lines were already returned earlier in this turn and are unchanged.`
    return { kind: 'narrow', input, note }
  }

  private beforeBash(state: Scope, args: Record<string, unknown>, cwd: string): LedgerVerdict {
    const command = String(args.command ?? '')
    const parsed = parseShell(command, cwd)
    if (!parsed.pureRead) {
      if (TREE_CHANGERS.test(command)) {
        state.files.clear()
        state.totals.clear()
      } else {
        for (const path of [...state.files.keys()]) if (mentions(command, path, cwd)) this.forget(state, path)
      }
      state.searches.clear()
      return { kind: 'allow' }
    }
    if (parsed.textSearch && parsed.reads.length === 0 && state.searches.has(`Bash ${command.trim()}`)) {
      this.onSkip?.({ tool: 'Bash', path: command.trim().slice(0, 120), lines: 0, verdict: 'deny' })
      return { kind: 'deny', reason: 'This exact search command was already answered earlier in this turn and nothing has been edited since; reuse that output or change the query.' }
    }
    if (parsed.reads.length === 0 || parsed.readSegments !== parsed.segments) return { kind: 'allow' }
    if (!parsed.reads.every((read) => ledgered(read.path, cwd))) return { kind: 'allow' }
    const covered = parsed.reads.every((read) => {
      const seen = state.files.get(read.path)
      if (!seen) return false
      const total = state.totals.get(read.path) ?? WHOLE
      return subtract({ start: read.range.start, end: Math.min(read.range.end, total) }, seen).length === 0
    })
    if (!covered) return { kind: 'allow' }
    const lines = parsed.reads.reduce((sum, read) => sum + Math.min(span(read.range), state.totals.get(read.path) ?? span(read.range)), 0)
    this.onSkip?.({ tool: 'Bash', path: parsed.reads.map((read) => read.path).join(', '), lines, verdict: 'deny' })
    const shown = parsed.reads.map((read) => describe(read.path, read.range, state.totals.get(read.path) ?? WHOLE)).join('; ')
    return { kind: 'deny', reason: `${shown} already returned earlier in this turn, and nothing has changed since. Use that copy, or read lines outside it (the Read tool takes offset and limit).` }
  }

  private scope(id: string): Scope {
    let state = this.scopes.get(id)
    if (!state) {
      state = { files: new Map(), totals: new Map(), searches: new Set() }
      this.scopes.set(id, state)
    }
    return state
  }

  private remember(state: Scope, path: string, range: LineRange): void {
    if (!(range.start >= 1) || range.end < range.start) return
    state.files.set(path, merge([...(state.files.get(path) ?? []), range]))
  }

  private forget(state: Scope, path: string): void {
    state.files.delete(path)
    state.totals.delete(path)
  }
}

/** Whether a path is stable source worth remembering: inside the workspace and not a volatile file. */
function ledgered(path: string, cwd: string): boolean {
  const root = resolve(cwd)
  return (path === root || path.startsWith(`${root}/`)) && !VOLATILE_PATH.test(path)
}

function scopeOf(input: HookInput): string {
  return 'agent_id' in input && typeof input.agent_id === 'string' && input.agent_id ? input.agent_id : 'main'
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberOf(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null
}

function searchKey(tool: string, args: Record<string, unknown>): string {
  return `${tool} ${JSON.stringify(Object.keys(args).sort().map((key) => [key, args[key]]))}`
}

function span(range: LineRange): number {
  return range.end === WHOLE ? WHOLE : range.end - range.start + 1
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

/** The parts of `wanted` no range in `seen` covers. */
export function subtract(wanted: LineRange, seen: readonly LineRange[]): LineRange[] {
  const gaps: LineRange[] = []
  let cursor = wanted.start
  for (const range of merge(seen)) {
    if (range.end < cursor) continue
    if (range.start > wanted.end) break
    if (range.start > cursor) gaps.push({ start: cursor, end: range.start - 1 })
    cursor = Math.max(cursor, range.end + 1)
    if (cursor > wanted.end || cursor === WHOLE) break
  }
  if (cursor <= wanted.end && cursor !== WHOLE) gaps.push({ start: cursor, end: wanted.end })
  return gaps
}

function describe(path: string, ranges: LineRange | readonly LineRange[], total: number): string {
  const list = Array.isArray(ranges) ? ranges : [ranges as LineRange]
  const whole = list.length === 1 && list[0]!.start <= 1 && list[0]!.end >= total
  if (whole) return `All of ${path} was`
  const parts = list.map((range) => range.end === WHOLE ? `${range.start} to the end` : range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`)
  const single = list.length === 1 && list[0]!.start === list[0]!.end
  return `${path} line${single ? '' : 's'} ${parts.join(', ')} ${single ? 'was' : 'were'}`
}

function mentions(command: string, path: string, cwd: string): boolean {
  if (command.includes(path)) return true
  const relative = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : null
  return relative !== null && command.includes(relative)
}

type ShellRead = { path: string; range: LineRange }
type ParsedShell = { pureRead: boolean; segments: number; readSegments: number; reads: ShellRead[]; textSearch: boolean }

/**
 * A conservative reading of a shell command: pure when every segment is a known read-only
 * program and nothing redirects. Reads are recognised for cat, nl, head, and `sed -n` line
 * ranges; other pure segments (searches, listings) count as segments without reads.
 */
export function parseShell(command: string, cwd: string): ParsedShell {
  const segments = splitSegments(command)
  const reads: ShellRead[] = []
  let pureRead = segments.length > 0
  let readSegments = 0
  let textSearch = false
  for (const segment of segments) {
    const before = reads.length
    const words = shellWords(segment)
    if (words.some((word) => /^\d*>{1,2}/.test(word) || word === '>' || word === '>>' || word === '&>')) pureRead = false
    let index = 0
    while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!)) index++
    const program = words[index] ?? ''
    const rest = words.slice(index + 1)
    if (program === 'git') {
      if (!READ_GIT_VERBS.has(rest[0] ?? '')) pureRead = false
      continue
    }
    if (program === 'sed') {
      if (!rest.includes('-n') || rest.some((word) => /^-[a-zA-Z]*i/.test(word))) { pureRead = false; continue }
      const expressions = rest.filter((word) => /^\d+,\d+p(?:;\d+,\d+p)*$/.test(word) || /^\d+p$/.test(word))
      const paths = rest.filter((word, position) => !word.startsWith('-') && !expressions.includes(word) && rest[position - 1] !== '-e')
      for (const expression of expressions) {
        for (const piece of expression.split(';')) {
          const match = /^(\d+)(?:,(\d+))?p$/.exec(piece)
          if (!match) continue
          for (const path of paths) reads.push({ path: resolve(cwd, path), range: { start: Number(match[1]), end: Number(match[2] ?? match[1]) } })
        }
      }
      if (reads.length > before) readSegments++
      continue
    }
    if (!READ_COMMANDS.has(program)) { pureRead = false; continue }
    if (TEXT_SEARCHES.has(program)) textSearch = true
    if (program === 'cat' || program === 'nl') {
      for (const word of rest) if (!word.startsWith('-') && looksLikePath(word)) reads.push({ path: resolve(cwd, word), range: { start: 1, end: WHOLE } })
    } else if (program === 'head') {
      let count = 10
      const paths: string[] = []
      for (let position = 0; position < rest.length; position++) {
        const word = rest[position]!
        if (word === '-n' || word === '-c') { count = word === '-n' ? Number(rest[++position]) : Number.NaN; continue }
        const short = /^-n?(\d+)$/.exec(word)
        if (short) { count = Number(short[1]); continue }
        if (!word.startsWith('-') && looksLikePath(word)) paths.push(word)
      }
      if (Number.isFinite(count)) for (const path of paths) reads.push({ path: resolve(cwd, path), range: { start: 1, end: count } })
    }
    if (reads.length > before) readSegments++
  }
  return { pureRead, segments: segments.length, readSegments, reads, textSearch }
}

function looksLikePath(word: string): boolean {
  return isAbsolute(word) || /[./]/.test(word)
}

function splitSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: string | null = null
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (quote) {
      current += char
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"') current += command[++index] ?? ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
    if (char === '\\') { current += char + (command[++index] ?? ''); continue }
    const pair = command.slice(index, index + 2)
    if (pair === '&&' || pair === '||') { segments.push(current); current = ''; index++; continue }
    if (char === ';' || char === '|' || char === '\n') { segments.push(current); current = ''; continue }
    current += char
  }
  segments.push(current)
  return segments.map((segment) => segment.trim()).filter(Boolean)
}

function shellWords(segment: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (let index = 0; index < segment.length; index++) {
    const char = segment[index]!
    if (quote) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"') current += segment[++index] ?? ''
      else current += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue }
    if (char === '\\') { current += segment[++index] ?? ''; started = true; continue }
    if (/\s/.test(char)) {
      if (started) words.push(current)
      current = ''
      started = false
      continue
    }
    current += char
    started = true
  }
  if (started) words.push(current)
  return words
}
