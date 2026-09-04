import type { ToolAction } from '../action-tool.js'
import { booleanArg, numberArg, stringArg, textResult } from '../tool.js'
import { cleanPath, fileSet, inputSchema, pathField, siblingTests } from './query.js'
import { factsFor, scanWorkspace, type FileFacts } from './scan.js'

export const includeRelatedField = {
  type: 'boolean', description: 'Include bounded related stylesheet rules and sibling test paths; default true.'
}
export const maxCharsField = {
  type: 'integer', minimum: 1_000, maximum: 16_000,
  description: 'Total source-bundle character budget, including hashes and metadata; default 12000.'
}

export function readAction(root: string): ToolAction {
  return {
    action: 'read',
    description: 'Read source with its SHA-256 file version, line numbers, related CSS rules and test paths in one call. ' +
      'Select an exported symbol or a line range (default first 200 lines). Pass known_hash only when that range is ' +
      'already in your context: an equal current hash returns unchanged; a changed hash returns fresh source immediately. ' +
      'Hashes describe snapshots, not edit locks or proof that omitted lines were read.',
    inputSchema: inputSchema({
      path: pathField,
      symbol: { type: 'string', minLength: 1, description: 'Exact exported symbol; cannot be combined with line bounds.' },
      start_line: { type: 'integer', minimum: 1 },
      end_line: { type: 'integer', minimum: 1 },
      known_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      include_related: includeRelatedField,
      max_chars: maxCharsField
    }, ['path']),
    async run(input) {
      const file = cleanPath(stringArg(input, 'path') ?? '')
      if (!fileSet.has(file)) throw new Error(`${JSON.stringify(file)} is not an indexed file`)
      const facts = await factsFor(root, file)
      if (!facts) throw new Error(`${JSON.stringify(file)} could not be read as bounded UTF-8 source`)
      const symbol = stringArg(input, 'symbol')
      if (symbol && (input.start_line !== undefined || input.end_line !== undefined)) throw new Error('Choose symbol or line bounds, not both')
      const matches = symbol ? facts.exports.filter((entry) => entry.name === symbol) : []
      if (symbol && matches.length !== 1) throw new Error('Symbol must identify exactly one exported declaration; use line bounds otherwise')
      const start = matches[0]?.line ?? numberArg(input, 'start_line', 1)
      const end = matches[0]?.end ?? numberArg(input, 'end_line', start + 199)
      if (end < start || start > facts.lines.length) throw new Error('Line range is outside the file')
      const unchanged = stringArg(input, 'known_hash') === facts.hash
      const related = booleanArg(input, 'include_related', true)
      const scanned = related && facts.styleRefs.length ? await scanWorkspace(root) : []
      return textResult(sourceBundle(facts, start, end, scanned, {
        maxChars: numberArg(input, 'max_chars', 12_000), related, unchanged
      }))
    }
  }
}

type BundleOptions = { maxChars: number; related: boolean; unchanged?: boolean }

/** Budget before serialization; never claim a line that was cut by a character limit. */
export function sourceBundle(facts: FileFacts, start: number, end: number, scanned: readonly FileFacts[], options: BundleOptions): string {
  const out = new SourceBudget(options.maxChars)
  if (options.unchanged) {
    out.add(`Unchanged at read time: ${facts.file}\n${facts.hash}\nRequested lines ${start}-${Math.min(end, facts.lines.length)}; no source re-emitted.\n`)
  } else {
    out.source(facts, start, end)
  }
  if (options.related) {
    const tests = siblingTests(facts.file)
    out.add(`\nSibling test candidates (not coverage): ${tests.length ? tests.join(', ') : '(none)'}\n`)
    const names = new Set(facts.styleRefs)
    for (const candidate of scanned) {
      const seen = new Set<string>()
      for (const rule of candidate.styleDefs) {
        const key = `${rule.line}:${rule.end}`
        if (!names.has(rule.name) || seen.has(key)) continue
        seen.add(key)
        out.source(candidate, rule.line, rule.end, rule.conditions.join(' > '))
      }
    }
  }
  return out.result()
}

class SourceBudget {
  private text = ''
  private omitted = false
  constructor(private readonly max: number) {}

  add(value: string): boolean {
    if (this.text.length + value.length > this.max - 180) { this.omitted = true; return false }
    this.text += value
    return true
  }

  source(facts: FileFacts, start: number, end: number, condition = ''): void {
    end = Math.min(end, facts.lines.length)
    const prefix = `\nSource: ${facts.file}\n${facts.hash}\n${condition ? `Conditions: ${condition}\n` : ''}`
    // Reserve the range header before selecting complete lines.
    let room = this.max - 180 - this.text.length - prefix.length - 90
    const lines: string[] = []
    for (let line = start; line <= end; line++) {
      const value = `${line}: ${facts.lines[line - 1]}\n`
      if (value.length > room) break
      lines.push(value)
      room -= value.length
    }
    if (!lines.length) { this.omitted = true; return }
    const last = start + lines.length - 1
    this.add(`${prefix}Returned lines ${start}-${last} of ${facts.lines.length}${last < end ? `; requested through ${end}` : ''}\n${lines.join('')}`)
    if (last < end) this.omitted = true
  }

  result(): string {
    return this.text + (this.omitted ? '\n[Source or related content omitted by budget. Read the missing path/range; omitted lines are not returned coverage.]' : '')
  }
}
