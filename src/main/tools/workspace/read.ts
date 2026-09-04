import type { ToolAction } from '../action-tool.js'
import { booleanArg, numberArg, stringArg, textResult } from '../tool.js'
import { cleanPath, fileSet, inputSchema, pathField, siblingTests } from './query.js'
import { factsFor, type FileFacts } from './scan.js'
import { readRelated, type ReadRelated } from './read-related.js'
import type { SourceReadObservation } from '../source-read-history.js'

export const includeRelatedField = {
  type: 'boolean', description: 'Include bounded local type definitions, relevant test excerpts, stylesheet rules and sibling test paths; default true.'
}
export const maxCharsField = {
  type: 'integer', minimum: 1_000, maximum: 16_000,
  description: 'Total source-bundle character budget, including hashes and metadata; default 12000.'
}

export function readAction(root: string): ToolAction {
  return {
    action: 'read',
    description: 'Read source with its SHA-256 file version, line numbers, referenced local types, relevant test excerpts and CSS rules in one call. ' +
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
      const extra = related ? await readRelated(root, facts, start, end) : null
      const sourceReads: SourceReadObservation[] = []
      const text = sourceBundle(facts, start, end, extra, {
        maxChars: numberArg(input, 'max_chars', 12_000), related, unchanged,
        observe: (snapshot) => sourceReads.push({ cwd: root, path: snapshot.path, hash: snapshot.hash })
      })
      return { ...textResult(text), sourceReads }
    }
  }
}

type BundleOptions = { maxChars: number; related: boolean; unchanged?: boolean; observe?: (facts: FileFacts) => void }

/** Budget before serialization; never claim a line that was cut by a character limit. */
export function sourceBundle(facts: FileFacts, start: number, end: number, extra: ReadRelated | null, options: BundleOptions): string {
  const out = new SourceBudget(options.maxChars, options.observe)
  let primaryEnd: number | undefined
  if (options.unchanged) {
    out.add(`Unchanged at read time: ${facts.file}\n${facts.hash}\nRequested lines ${start}-${Math.min(end, facts.lines.length)}; no source re-emitted.\n`)
    primaryEnd = Math.min(end, facts.lines.length)
    options.observe?.(facts)
  } else {
    const hasRelated = extra && (extra.types.length || extra.tests.length || extra.styles.length)
    const primaryBudget = hasRelated ? Math.floor(options.maxChars * 0.6) : options.maxChars
    primaryEnd = out.source(facts, start, end, '', primaryBudget)
  }
  if (options.related) {
    const tests = siblingTests(facts.file)
    out.add(`\nSibling test candidates (not coverage): ${tests.length ? tests.join(', ') : '(none)'}\n`)
    const types = extra?.types.filter((entry) => !(entry.facts.file === facts.file && primaryEnd !== undefined && entry.start >= start && entry.end <= primaryEnd)) ?? []
    const groups = [types, extra?.tests ?? [], extra?.styles ?? []].filter((entries) => entries.length)
    for (const note of extra?.notes ?? []) out.add(`\n[${note}]\n`)
    for (const [index, entries] of groups.entries()) {
      const groupEnd = out.length + Math.floor(out.remaining / (groups.length - index))
      for (const [entryIndex, entry] of entries.entries()) {
        const budget = out.length + Math.floor((groupEnd - out.length) / (entries.length - entryIndex))
        out.source(entry.facts, entry.start, entry.end, entry.label, budget)
      }
    }
  }
  return out.result()
}

class SourceBudget {
  private text = ''
  private omitted = false
  constructor(private readonly max: number, private readonly observe?: (facts: FileFacts) => void) {}
  get length(): number { return this.text.length }
  get remaining(): number { return Math.max(0, this.max - 180 - this.text.length) }

  add(value: string): boolean {
    if (this.text.length + value.length > this.max - 180) { this.omitted = true; return false }
    this.text += value
    return true
  }

  source(facts: FileFacts, start: number, end: number, label = '', budget = this.max): number | undefined {
    end = Math.min(end, facts.lines.length)
    const prefix = `\nSource: ${facts.file}\n${facts.hash}\n${label ? `${label}\n` : ''}`
    // Reserve the range header before selecting complete lines.
    let room = budget - 180 - this.text.length - prefix.length - 90
    const lines: string[] = []
    for (let line = start; line <= end; line++) {
      const value = `${line}: ${facts.lines[line - 1]}\n`
      if (value.length > room) break
      lines.push(value)
      room -= value.length
    }
    if (!lines.length) {
      const notice = `${prefix}No complete lines fit for requested range ${start}-${end}.\n`
      if (this.text.length + notice.length <= budget - 180) this.add(notice)
      this.omitted = true
      return
    }
    const last = start + lines.length - 1
    const added = this.add(`${prefix}Returned lines ${start}-${last} of ${facts.lines.length}${last < end ? `; requested through ${end}` : ''}\n${lines.join('')}`)
    if (last < end) this.omitted = true
    if (added) this.observe?.(facts)
    return added ? last : undefined
  }

  result(): string {
    return this.text + (this.omitted ? '\n[Source or related content omitted by budget. Read the missing path/range; omitted lines are not returned coverage.]' : '')
  }
}
