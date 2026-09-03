import type { ToolAction } from '../action-tool.js'
import { booleanArg, numberArg, stringArg, textResult } from '../tool.js'
import { inputSchema, ipcFlows, maxResultsField, testPattern } from './query.js'
import { scanWorkspace, type FileFacts } from './scan.js'

// One call answers "where does this live?" whatever the model has in hand: an exported
// symbol, a `data-ui` control id read off a screenshot, a CSS class, a path fragment, an IPC
// namespace, or a user-visible label. Typed matches are ranked above raw line matches, so the
// definition sorts above the places that merely mention it.

const KINDS = ['symbol', 'ui', 'style', 'file', 'ipc', 'text'] as const
type Kind = typeof KINDS[number]

type Hit = { kind: Kind; file: string; line: number; detail: string; rank: number }

const PER_KIND = 12
const SNIPPET = 110

export function findAction(root: string): ToolAction {
  return {
    action: 'find',
    description:
      'Locate something by name across the whole repository in one call. The query is matched ' +
      'against exported symbols, `data-ui` control ids, CSS class definitions, file paths, IPC ' +
      'namespaces, and finally the text of every indexed line. Results are `file:line` grouped ' +
      'by match kind, definitions before mentions. This is the first move for "where is X"; ' +
      'reach for a raw text search only when a query needs a regex.',
    inputSchema: inputSchema({
      query: { type: 'string', minLength: 2, description: 'Symbol, control id, class name, path fragment, or visible label.' },
      kind: { type: 'string', enum: [...KINDS], description: 'Restrict results to one match kind.' },
      include_tests: { type: 'boolean', description: 'Include test files; default false.' },
      max_results: maxResultsField
    }, ['query']),
    async run(input) {
      const query = (stringArg(input, 'query') ?? '').trim()
      if (!query) throw new Error('`query` must not be empty')
      const kind = stringArg(input, 'kind') as Kind | undefined
      const includeTests = booleanArg(input, 'include_tests', false)
      const maxResults = numberArg(input, 'max_results', 40)

      const scanned = await scanWorkspace(root)
      const files = scanned.filter((facts) => includeTests || !testPattern.test(facts.file))
      const hits = collectHits(files, query, kind)
      return textResult(render(query, kind, includeTests, hits, maxResults))
    }
  }
}

function collectHits(files: readonly FileFacts[], query: string, kind: Kind | undefined): Hit[] {
  const wanted = (candidate: Kind): boolean => !kind || kind === candidate
  const hits: Hit[] = []

  for (const facts of files) {
    if (wanted('symbol')) {
      for (const symbol of facts.exports) {
        const rank = nameRank(symbol.name, query)
        if (rank !== null) hits.push({ kind: 'symbol', file: facts.file, line: symbol.line, detail: `${symbol.kind} ${symbol.name}`, rank })
      }
    }
    if (wanted('ui')) {
      for (const control of dedupe(facts.controls)) {
        const rank = nameRank(control.name, query)
        if (rank !== null) hits.push({ kind: 'ui', file: facts.file, line: control.line, detail: `data-ui="${control.name}"`, rank })
      }
    }
    if (wanted('style')) {
      for (const style of facts.styleDefs) {
        const rank = nameRank(style.name, query)
        // Show the selector line itself; four rules for one class differ only in their selector.
        if (rank !== null) hits.push({ kind: 'style', file: facts.file, line: style.line, detail: snippet(facts.lines[style.line - 1] ?? `.${style.name}`), rank })
      }
    }
    if (wanted('file')) {
      const rank = nameRank(facts.file.split('/').at(-1) ?? '', query) ?? (facts.file.includes(query) ? 2 : null)
      if (rank !== null) hits.push({ kind: 'file', file: facts.file, line: 1, detail: 'indexed file', rank })
    }
  }

  if (wanted('ipc')) {
    for (const [namespace, owners] of Object.entries(ipcFlows)) {
      const rank = nameRank(namespace, query)
      if (rank === null) continue
      for (const owner of owners) hits.push({ kind: 'ipc', file: owner, line: 1, detail: `handles ${namespace}:*`, rank })
    }
  }

  // Text is the fallback: every line that mentions the query, minus lines a typed match
  // already reported, so a definition is never listed twice.
  if (wanted('text') && query.length >= 3) {
    const claimed = new Set(hits.map((hit) => `${hit.file}:${hit.line}`))
    const needle = query.toLowerCase()
    for (const facts of files) {
      facts.lines.forEach((line, index) => {
        if (!line.toLowerCase().includes(needle)) return
        if (claimed.has(`${facts.file}:${index + 1}`)) return
        hits.push({ kind: 'text', file: facts.file, line: index + 1, detail: snippet(line), rank: textRank(facts.file, line, needle) })
      })
    }
  }
  return hits
}

const COMMENT = /^\s*(?:\/\/|\/\*|\*|<!--)/
const PROSE = /\.(?:md|json|html)$/
const JSX_TEXT = />([^<>{}]*)</g
const LABEL_ATTR = /(?:aria-label|title|placeholder|label|alt)=["']([^"']*)["']/g

/**
 * Rank text hits so the answer to "I saw this string in the UI" sorts first: rendered labels,
 * then ordinary code, then comments about it, then prose. Without this, alphabetical order puts
 * `docs/` above the component that actually renders the string.
 */
function textRank(file: string, line: string, needle: string): number {
  if (rendersLabel(line, needle)) return 2.5
  if (PROSE.test(file)) return 4
  return COMMENT.test(line) ? 3.5 : 3
}

/** True when the query sits in JSX body text or a user-facing attribute — something on screen. */
function rendersLabel(line: string, needle: string): boolean {
  const lowered = line.toLowerCase()
  for (const match of lowered.matchAll(JSX_TEXT)) if (match[1]!.includes(needle)) return true
  for (const match of lowered.matchAll(LABEL_ATTR)) if (match[1]!.includes(needle)) return true
  return false
}

/** 0 exact, 1 prefix or suffix segment, 2 substring, null no match. Case-insensitive. */
function nameRank(name: string, query: string): number | null {
  const candidate = name.toLowerCase()
  const needle = query.toLowerCase()
  if (candidate === needle) return 0
  if (candidate.startsWith(needle) || candidate.endsWith(needle)) return 1
  return candidate.includes(needle) ? 2 : null
}

function dedupe(entries: readonly { name: string; line: number }[]): { name: string; line: number }[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.name)) return false
    seen.add(entry.name)
    return true
  })
}

function snippet(line: string): string {
  const trimmed = line.trim()
  return trimmed.length > SNIPPET ? `${trimmed.slice(0, SNIPPET)}…` : trimmed
}

function render(query: string, kind: Kind | undefined, includeTests: boolean, hits: Hit[], maxResults: number): string {
  const scope = kind ? `kind ${kind}` : 'all kinds'
  const header = `Workspace find: ${JSON.stringify(query)} (${scope}; ${includeTests ? 'tests included' : 'tests omitted'})`
  if (hits.length === 0) {
    return `${header}\n\n(no match)\n\nTry a shorter query, kind:"text" for prose, or include_tests:true.`
  }

  const ordered = [...hits].sort((a, b) => a.rank - b.rank || a.file.localeCompare(b.file) || a.line - b.line)
  const sections: string[] = []
  let shown = 0
  let omitted = 0
  for (const candidate of KINDS) {
    const group = ordered.filter((hit) => hit.kind === candidate)
    if (group.length === 0) continue
    const room = Math.max(0, Math.min(PER_KIND, maxResults - shown))
    const visible = group.slice(0, room)
    omitted += group.length - visible.length
    if (visible.length === 0) continue
    shown += visible.length
    const width = Math.max(...visible.map((hit) => `${hit.file}:${hit.line}`.length))
    const rows = visible.map((hit) => `  ${`${hit.file}:${hit.line}`.padEnd(width)}  ${hit.detail}`)
    sections.push(`${candidate} (${group.length}):\n${rows.join('\n')}`)
  }
  const footer = omitted > 0 ? `\n\n[${omitted} more hits omitted; pass kind or raise max_results]` : ''
  return `${header}\n\n${sections.join('\n\n')}${footer}`
}
