import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const MAX_FILE_BYTES = 1_000_000
const MAX_RG_BYTES = 2_000_000
export type ReadRequest = { path: string; from_line?: number; to_line?: number }
export type SearchRequest = { pattern: string; path?: string; regex?: boolean }

/** All subprocess arguments are literal argv. Never execute model-supplied shell text. */
function rg(root: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((done, reject) => {
    execFile('rg', args, { cwd: root, signal, timeout: 15_000, maxBuffer: MAX_RG_BYTES, encoding: 'utf8' }, (error, stdout) => {
      if (error && (error as { code?: string | number }).code !== 1) reject(error)
      else done(stdout)
    })
  })
}

export async function scopedPath(root: string, path: string): Promise<string> {
  if (isAbsolute(path)) throw new Error('Use a path relative to the calling chat project')
  const base = await realpath(root)
  const target = await realpath(resolve(base, path))
  const rel = relative(base, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path leaves the calling chat project')
  return target
}

export async function readRange(root: string, request: ReadRequest, signal: AbortSignal, budget = 2800) {
  signal.throwIfAborted()
  const path = await scopedPath(root, request.path)
  const handle = await open(path, 'r')
  let text: string
  let sha256: string
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Read requires a regular text file no larger than 1 MB')
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead > MAX_FILE_BYTES || bytes.subarray(0, bytesRead).includes(0)) throw new Error('File is too large or binary')
    sha256 = createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex')
    text = bytes.subarray(0, bytesRead).toString('utf8')
  } finally { await handle.close() }
  signal.throwIfAborted()
  const lines = text.split('\n')
  const from = request.from_line ?? 1
  const to = Math.min(request.to_line ?? from + 79, lines.length)
  if (to < from || from < 1) throw new Error('Invalid or out-of-range line range')
  const rows: string[] = []
  const textBudget = Math.max(0, budget - JSON.stringify(request.path).length - 320)
  let used = 0
  let line = from
  for (; line <= to; line++) {
    const row = `${line}| ${lines[line - 1]}`
    if (used + JSON.stringify(row).length > textBudget) break
    rows.push(row)
    used += JSON.stringify(row).length + 1
  }
  return {
    path: request.path, sha256, totalLines: lines.length,
    fromLine: from, toLine: line - 1, text: rows.join('\n'),
    ...(line <= to ? { nextFromLine: line, truncated: true, ...(rows.length ? {} : { reason: 'Line exceeds output budget; use a narrower exact search' }) } : {})
  }
}

export async function search(root: string, request: SearchRequest, signal: AbortSignal, limit = 12) {
  const target = await scopedPath(root, request.path ?? '.')
  const output = await rg(root, ['--json', '--no-config', '--max-count', '4', '--max-filesize', '1M',
    '--glob', '!.git/**', ...(request.regex ? [] : ['--fixed-strings']), '-i', '-e', request.pattern, '--', target], signal)
  const matches: Array<{ path: string; line: number; text: string }> = []
  let total = 0
  let used = 0
  for (const row of output.split('\n')) {
    if (!row) continue
    const event = JSON.parse(row)
    if (event.type !== 'match' || typeof event.data?.path?.text !== 'string') continue
    total++
    const match = {
      path: relative(root, event.data.path.text), line: event.data.line_number,
      text: String(event.data.lines.text).trimEnd().slice(0, 220),
      textTruncated: String(event.data.lines.text).trimEnd().length > 220
    }
    const size = JSON.stringify(match).length
    if (matches.length < limit && used + size < 2800) { matches.push(match); used += size }
  }
  return { matches, truncated: total > matches.length, perFileMatchLimit: 4 }
}

const STOP_WORDS = new Set('the a an to of and or in on for with when after before is are be it this that from fix broken should does not no all user please can'.split(' '))
export function queryTerms(query: string): string[] {
  return [...new Set(query.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [])]
    .filter(term => !STOP_WORDS.has(term)).slice(0, 8)
}

/** Live lexical ranking, not embeddings. Ignore rules come from rg; no persisted stale index. */
export async function locate(root: string, query: string, signal: AbortSignal, limit = 6) {
  const terms = queryTerms(query)
  if (!terms.length) throw new Error('Describe a feature, symbol, or behavior using more specific words')
  const [listing, evidence] = await Promise.all([
    rg(root, ['--files', '--no-config', '-0', '--glob', '!.git/**'], signal),
    Promise.all(terms.map(pattern => search(root, { pattern }, signal, 40)))
  ])
  const candidates = new Map<string, { path: string; score: number; reasons: string[]; line: number }>()
  const add = (path: string, points: number, reason: string, line = 1) => {
    const current = candidates.get(path) ?? { path, score: 0, reasons: [], line }
    current.score += points
    if (!current.reasons.includes(reason)) current.reasons.push(reason)
    if (current.line === 1 && line > 1) current.line = line
    candidates.set(path, current)
  }
  for (const path of listing.split('\0').filter(Boolean)) {
    for (const term of terms) if (path.toLowerCase().includes(term)) add(path, 5, `path:${term}`)
  }
  evidence.forEach((result, index) => {
    const seen = new Set<string>()
    for (const match of result.matches) {
      if (seen.has(match.path)) continue
      seen.add(match.path)
      add(match.path, 2, `text:${terms[index]}`, match.line)
    }
  })
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit)
  const files = await Promise.all(ranked.map(async entry => {
    try {
      return { ...entry, excerpt: await readRange(root, { path: entry.path, from_line: Math.max(1, entry.line - 4), to_line: entry.line + 18 }, signal, 1100) }
    } catch (error) { return { ...entry, error: String(error).slice(0, 500) } }
  }))
  while (files.length > 1 && JSON.stringify(files).length > 12_000) files.pop()
  return { method: 'live-lexical', terms, files, candidateCount: candidates.size,
    truncated: candidates.size > files.length || evidence.some(result => result.truncated),
    guidance: 'Candidates are lexical evidence, not proof of ownership. Follow callers/imports with search_many and read_many before editing.' }
}
