import path from 'node:path'
import { readFileSnapshot, type FileSnapshot } from '../file-snapshot.js'
import { styleRules, type StyleRule } from './style-rules.js'
import type { SourceAnalysis } from './source-analysis.js'
export type { ExportedSymbol } from './source-analysis.js'

import { indexedFiles } from './query.js'

// Facts the navigation actions need are derived from the working tree at call time rather
// than baked into the generated index: the index would go stale between `npm run map` runs,
// and symbol/selector tables would dwarf its byte budget. The whole indexed tree is ~1.8 MB,
// so a full scan is cheap. Content hashes reuse parsing without trusting timestamps.

export type Located = { name: string; line: number }
export type FileFacts = FileSnapshot & SourceAnalysis & {
  file: string
  lines: readonly string[]
  /** `data-ui` and `data-ui-surface` ids this file renders. */
  controls: readonly Located[]
  /** Class names this stylesheet defines a rule for. */
  styleDefs: readonly StyleRule[]
  /** Class names referenced from a `className`/`class` attribute. */
  styleRefs: readonly string[]
}

const CODE = /\.(?:ts|tsx|mjs|js)$/
const STYLE = /\.css$/
const CONTROL_ATTR = /data-ui(?:-surface)?=["']([^"']+)["']/g
const CLASS_ATTR = /class(?:Name)?=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g
const cache = new Map<string, FileFacts>()

/** Every indexed file, parsed once per revision. Unreadable files are skipped, not fatal. */
export async function scanWorkspace(root: string, files: readonly string[] = indexedFiles): Promise<FileFacts[]> {
  const scanned = await Promise.all(files.map((file) => factsFor(root, file)))
  return scanned.filter((facts): facts is FileFacts => facts !== null)
}

export async function factsFor(root: string, file: string): Promise<FileFacts | null> {
  const absolute = path.join(root, file)
  try {
    const snapshot = await readFileSnapshot(absolute)
    const cached = cache.get(absolute)
    if (cached && cached.hash === snapshot.hash && cached.path === snapshot.path) return cached
    const facts = await parse(file, snapshot)
    if (cache.size >= 2_000) cache.clear()
    cache.set(absolute, facts)
    return facts
  } catch {
    return null
  }
}

async function parse(file: string, snapshot: FileSnapshot): Promise<FileFacts> {
  const { source, lines } = snapshot
  const code = CODE.test(file)
  // Keep the compiler parser out of app startup; load it only on the first source inspection.
  const analysis: SourceAnalysis = code
    ? (await import('./source-analysis.js')).analyzeSource(file, source)
    : { exports: [], imports: [], types: [], typeRefs: [], tests: [] }
  return {
    ...snapshot,
    ...analysis,
    file,
    lines,
    controls: code ? attributeMatches(lines, CONTROL_ATTR) : [],
    styleDefs: STYLE.test(file) ? styleRules(source) : [],
    styleRefs: code ? classReferences(source) : []
  }
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
