import { indexedFiles, resolveImport, siblingTests, testPattern } from './query.js'
import { factsFor, scanWorkspace, type FileFacts } from './scan.js'

export type RelatedExcerpt = { facts: FileFacts; start: number; end: number; label: string }
export type ReadRelated = { types: RelatedExcerpt[]; tests: RelatedExcerpt[]; styles: RelatedExcerpt[]; notes: string[] }
const MAX_TYPES = 6
const MAX_TESTS = 3

/** Direct explicit type references and tests using an import of the selected declaration. */
export async function readRelated(root: string, primary: FileFacts, start: number, end: number, available?: readonly FileFacts[]): Promise<ReadRelated> {
  const result: ReadRelated = { types: [], tests: [], styles: [], notes: [] }
  const snapshots = new Map((available ?? []).map((facts) => [facts.file, facts]))
  snapshots.set(primary.file, primary)
  const get = async (file: string): Promise<FileFacts | null> => {
    const cached = snapshots.get(file)
    if (cached) return cached
    const facts = await factsFor(root, file)
    if (facts) snapshots.set(file, facts)
    return facts
  }
  const refs = [...new Set(primary.typeRefs.filter((ref) => ref.line >= start && ref.line <= end).map((ref) => ref.name))]
  const seen = new Set<string>()
  for (const name of refs) {
    const resolved = await resolveType(primary, name, get, new Set())
    if (!resolved) continue
    const key = `${resolved.facts.file}:${resolved.start}:${resolved.end}`
    if (seen.has(key)) continue
    seen.add(key)
    if (result.types.length < MAX_TYPES) result.types.push({ ...resolved, label: `Referenced local type: ${name}` })
    else if (!result.notes.includes('Additional referenced types omitted (limit 6).')) result.notes.push('Additional referenced types omitted (limit 6).')
  }

  const candidates = available ?? await scanWorkspace(root, indexedFiles.filter((file) => testPattern.test(file) || (primary.styleRefs.length > 0 && file.endsWith('.css'))))
  const selected = new Set(primary.exports.filter((symbol) => symbol.line <= end && symbol.end >= start).map((symbol) => symbol.name))
  const siblings = new Set(siblingTests(primary.file))
  const ordered = [...candidates].sort((a, b) => Number(siblings.has(b.file)) - Number(siblings.has(a.file)) || a.file.localeCompare(b.file))
  let testCount = 0
  for (const facts of ordered) {
    const imports = facts.imports.filter((binding) => resolveImport(facts.file, binding.from) === primary.file)
    for (const candidate of facts.tests) {
      const matched = candidate.references.filter((ref) => imports.some((binding) =>
        binding.imported === '*' ? ref.startsWith(`${binding.local}.`) && selected.has(ref.slice(binding.local.length + 1)) : ref === binding.local && selected.has(binding.imported)))
      if (!testPattern.test(facts.file) || !matched.length) continue
      testCount++
      if (result.tests.length < MAX_TESTS) result.tests.push({ facts, start: candidate.line, end: candidate.end,
        label: `Test candidate: ${candidate.name.slice(0, 160)} (uses ${matched.join(', ')}; not execution or coverage evidence)` })
    }
    const names = new Set(primary.styleRefs)
    const styleRanges = new Set<string>()
    for (const rule of facts.styleDefs) {
      const key = `${rule.start}:${rule.end}`
      if (!names.has(rule.name) || styleRanges.has(key)) continue
      styleRanges.add(key)
      result.styles.push({ facts, start: rule.start, end: rule.end,
        label: rule.conditions.length ? `Conditions: ${rule.conditions.join(' > ')}` : 'Related stylesheet rule' })
    }
  }
  if (testCount > MAX_TESTS) result.notes.push(`${testCount - MAX_TESTS} additional test candidates omitted (limit 3).`)
  return result
}

type GetFacts = (file: string) => Promise<FileFacts | null>
type ResolvedType = Omit<RelatedExcerpt, 'label'>

async function resolveType(facts: FileFacts, name: string, get: GetFacts, visited: Set<string>, exported = false): Promise<ResolvedType | null> {
  const key = `${facts.file}:${name}`
  if (visited.has(key) || visited.size >= 4) return null
  visited.add(key)
  let localName = name
  if (exported) {
    const entries = facts.exports.filter((entry) => entry.name === name)
    if (entries.length !== 1) return null
    const entry = entries[0]!
    localName = entry.localName ?? name
    if (entry.from) {
      const path = resolveImport(facts.file, entry.from)
      const next = path ? await get(path) : null
      return next ? resolveType(next, localName, get, visited, true) : null
    }
  }
  const declarations = facts.types.filter((type) => type.name === localName)
  if (declarations.length === 1) return { facts, start: declarations[0]!.line, end: declarations[0]!.end }
  if (declarations.length > 1) return null
  const [local, member, ...rest] = localName.split('.')
  if (rest.length) return null
  const bindings = facts.imports.filter((binding) => binding.local === local)
  if (bindings.length !== 1) return null
  const binding = bindings[0]!
  if ((binding.imported === '*') !== !!member) return null
  const path = resolveImport(facts.file, binding.from)
  const next = path ? await get(path) : null
  return next ? resolveType(next, member ?? binding.imported, get, visited, true) : null
}
