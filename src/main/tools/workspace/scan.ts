import path from 'node:path'
import { readFileSnapshot, type FileSnapshot } from '../file-snapshot.js'
import { styleRules, type StyleRule } from './style-rules.js'

import { indexedFiles } from './query.js'

// Facts the navigation actions need are derived from the working tree at call time rather
// than baked into the generated index: the index would go stale between `npm run map` runs,
// and symbol/selector tables would dwarf its byte budget. The whole indexed tree is ~1.8 MB,
// so a full scan is cheap. Content hashes reuse parsing without trusting timestamps.

export type Located = { name: string; line: number }
/** `end` is the last line of the declaration, so a read can take exactly the symbol. */
export type ExportedSymbol = Located & { kind: string; end: number }

export type FileFacts = FileSnapshot & {
  file: string
  lines: readonly string[]
  /** Exported declarations and re-exported names. */
  exports: readonly ExportedSymbol[]
  /** `data-ui` and `data-ui-surface` ids this file renders. */
  controls: readonly Located[]
  /** Class names this stylesheet defines a rule for. */
  styleDefs: readonly StyleRule[]
  /** Class names referenced from a `className`/`class` attribute. */
  styleRefs: readonly string[]
}

const CODE = /\.(?:ts|tsx|mjs|js)$/
const STYLE = /\.css$/
const EXPORT_DECL = /^export\s+(?:default\s+)?(?:async\s+)?(function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/
const EXPORT_LIST = /^export\s*\{([^}]*)\}/
// A top-level statement or doc comment starts at column zero; the previous declaration ends
// on the last non-blank, non-comment line before it (a closing `}` at column zero is part of
// the declaration, not a new statement).
const TOP_LEVEL_START = /^(?:export\s|import\s|(?:async\s+)?function\s|const\s|let\s|var\s|class\s|type\s|interface\s|enum\s|\/\*\*|\/\/)/
const CONTROL_ATTR = /data-ui(?:-surface)?=["']([^"']+)["']/g
const CLASS_ATTR = /class(?:Name)?=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g
const cache = new Map<string, FileFacts>()

/** Every indexed file, parsed once per revision. Unreadable files are skipped, not fatal. */
export async function scanWorkspace(root: string): Promise<FileFacts[]> {
  const scanned = await Promise.all(indexedFiles.map((file) => factsFor(root, file)))
  return scanned.filter((facts): facts is FileFacts => facts !== null)
}

export async function factsFor(root: string, file: string): Promise<FileFacts | null> {
  const absolute = path.join(root, file)
  try {
    const snapshot = await readFileSnapshot(absolute)
    const cached = cache.get(absolute)
    if (cached && cached.hash === snapshot.hash && cached.path === snapshot.path) return cached
    const facts = parse(file, snapshot)
    if (cache.size >= 2_000) cache.clear()
    cache.set(absolute, facts)
    return facts
  } catch {
    return null
  }
}

function parse(file: string, snapshot: FileSnapshot): FileFacts {
  const { source, lines } = snapshot
  const code = CODE.test(file)
  return {
    ...snapshot,
    file,
    lines,
    exports: code ? exportedSymbols(lines) : [],
    controls: code ? attributeMatches(lines, CONTROL_ATTR) : [],
    styleDefs: STYLE.test(file) ? styleRules(source) : [],
    styleRefs: code ? classReferences(source) : []
  }
}

function exportedSymbols(lines: readonly string[]): ExportedSymbol[] {
  const found: ExportedSymbol[] = []
  lines.forEach((line, index) => {
    const declared = EXPORT_DECL.exec(line)
    if (declared) {
      found.push({ name: declared[2]!, kind: declared[1]!, line: index + 1, end: declarationEnd(lines, index) })
      return
    }
    const listed = EXPORT_LIST.exec(line)
    if (!listed) return
    for (const entry of listed[1]!.split(',')) {
      // `export { internalName as publicName }` is findable by the name importers write.
      const name = entry.trim().split(/\s+as\s+/).at(-1)?.replace(/^type\s+/, '').trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) found.push({ name, kind: 'reexport', line: index + 1, end: index + 1 })
    }
  })
  return found
}

/** One-based last line of the declaration starting at `start` (zero-based). */
function declarationEnd(lines: readonly string[], start: number): number {
  let end = start
  for (let index = start + 1; index < lines.length; index++) {
    const text = lines[index]!
    if (TOP_LEVEL_START.test(text)) break
    if (text.trim() !== '' && !/^\s*(?:\*|\/\/)/.test(text)) end = index
  }
  return end + 1
}

function attributeMatches(lines: readonly string[], pattern: RegExp): Located[] {
  const found: Located[] = []
  lines.forEach((line, index) => {
    for (const match of line.matchAll(pattern)) found.push({ name: match[1]!, line: index + 1 })
  })
  return found
}

function classReferences(source: string): string[] {
  const names = new Set<string>()
  for (const match of source.matchAll(CLASS_ATTR)) {
    for (const token of (match[1] ?? match[2] ?? match[3] ?? '').split(/[\s$]+/)) {
      const name = token.trim()
      if (/^-?[A-Za-z_][-\w]*$/.test(name)) names.add(name)
    }
  }
  return [...names].sort()
}

/** Blank comment bodies while preserving line structure, so line numbers stay true. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
}

/**
 * Class names that own a rule in this stylesheet. Braces are tracked with a small stack so
 * that at-rule wrappers (`@media`, `@supports`) stay transparent and the rules nested inside
 * them are still recorded as definitions.
 */
function styleDefinitions(lines: readonly string[]): Located[] {
  const found: Located[] = []
  const stack: Array<'at' | 'rule'> = []
  let pending: Located[] = []
  const atSelectorLevel = (): boolean => stack.every((kind) => kind === 'at')
  const collect = (segment: string, line: number): void => {
    if (segment.trimStart().startsWith('@')) return
    for (const match of segment.matchAll(CLASS_TOKEN)) pending.push({ name: match[1]!, line })
  }

  lines.forEach((line, index) => {
    let segment = ''
    for (const character of line) {
      if (character === '{') {
        const kind = segment.trimStart().startsWith('@') ? 'at' : 'rule'
        if (kind === 'rule' && atSelectorLevel()) {
          collect(segment, index + 1)
          found.push(...pending)
        }
        stack.push(kind)
        pending = []
        segment = ''
      } else if (character === '}') {
        stack.pop()
        pending = []
        segment = ''
      } else if (character === ';' && atSelectorLevel()) {
        pending = []
        segment = ''
      } else {
        segment += character
      }
    }
    // A selector may span lines (".a,\n.b {"); keep its tokens until the brace arrives.
    if (atSelectorLevel()) collect(segment, index + 1)
  })
  return found
}
