/**
 * Forgiving text matching shared by chat search surfaces (hot index, pane scan, history list, recall).
 *
 * Tiers, strongest first:
 * - exact: case-insensitive literal phrase (whitespace runs collapsed).
 * - spacing: same letters and digits once spaces, punctuation, and diacritics are ignored
 *   ("spinev1" finds "spine v1", "spine-v1", "Spine_V1").
 * - fuzzy: bounded edits against that compact form ("spnie v1"), or every query word found
 *   anywhere in the text within a per-word edit budget ("chat spine" finds "spine for chats").
 *
 * Edit budgets scale with length so short queries never match loosely.
 */

import type { ChatTextMatchKind } from '../../shared/chat-index.js'

export type TextMatchKind = ChatTextMatchKind

export type TextMatch = {
  kind: TextMatchKind
  /** Start offset of the matched span in the original text (first matched word for word matches). */
  start: number
  /** End offset (exclusive) in the original text. */
  end: number
  /** 0..1, higher is closer; exact is 1. */
  quality: number
}

export type PreparedTextQuery = {
  phrase: string
  compact: string
  words: string[]
}

const MAX_FUZZY_COMPACT_CHARS = 64
const MIN_FUZZY_COMPACT_CHARS = 5
const MIN_SPACING_COMPACT_CHARS = 3

/** Case-, accent-, and punctuation-folded letters/digits of one character ('' when it is neither). */
function foldChar(char: string): string {
  const code = char.charCodeAt(0)
  if (code < 128) {
    if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) return char
    return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ''
  }
  const folded = char.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
  return /^[\p{L}\p{N}]+$/u.test(folded) ? folded : ''
}

type Folded = { compact: string; offsets: number[] }

/** Compact folded form plus, for each compact char, its offset in the original text. */
function foldText(text: string): Folded {
  let compact = ''
  const offsets: number[] = []
  let offset = 0
  for (const char of text) {
    const folded = foldChar(char)
    for (let i = 0; i < folded.length; i += 1) {
      compact += folded[i]
      offsets.push(offset)
    }
    offset += char.length
  }
  return { compact, offsets }
}

type Word = { text: string; start: number; end: number }

function foldWords(text: string): Word[] {
  const words: Word[] = []
  let current = ''
  let start = -1
  let offset = 0
  for (const char of text) {
    const folded = foldChar(char)
    if (folded) {
      if (start < 0) start = offset
      current += folded
    } else if (start >= 0) {
      words.push({ text: current, start, end: offset })
      current = ''
      start = -1
    }
    offset += char.length
  }
  if (start >= 0) words.push({ text: current, start, end: offset })
  return words
}

/** Edits tolerated for a folded token of this length. */
export function editBudget(length: number): number {
  if (length < MIN_FUZZY_COMPACT_CHARS) return 0
  if (length <= 8) return 1
  if (length <= 16) return 2
  return 3
}

export function prepareTextQuery(raw: string | null | undefined): PreparedTextQuery | null {
  const phrase = (raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (!phrase) return null
  return {
    phrase,
    compact: foldText(phrase).compact,
    words: foldWords(phrase).map((word) => word.text)
  }
}

/** Optimal string alignment distance, abandoned once it must exceed max. */
function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prevPrev: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prevPrev[j - 2] + 1)
      row.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    prevPrev = prev
    prev = row
  }
  return prev[b.length]
}

/** Best approximate occurrence of pattern inside text (Sellers), or null beyond max edits. */
function approximateSubstring(pattern: string, text: string, max: number): { end: number; distance: number } | null {
  const m = pattern.length
  let prev = new Uint16Array(m + 1).map((_, i) => i)
  let row = new Uint16Array(m + 1)
  let best: { end: number; distance: number } | null = null
  for (let j = 1; j <= text.length; j += 1) {
    row[0] = 0
    for (let i = 1; i <= m; i += 1) {
      const cost = pattern[i - 1] === text[j - 1] ? 0 : 1
      row[i] = Math.min(prev[i] + 1, row[i - 1] + 1, prev[i - 1] + cost)
    }
    if (row[m] <= max && (!best || row[m] < best.distance)) {
      best = { end: j, distance: row[m] }
      if (row[m] === 0) break
    }
    ;[prev, row] = [row, prev]
  }
  return best
}

/** Closest text word for one query word: exact containment, prefix, or bounded edits. */
function matchWord(queryWord: string, words: Word[]): { word: Word; similarity: number } | null {
  let best: { word: Word; similarity: number } | null = null
  const budget = editBudget(queryWord.length)
  for (const word of words) {
    let similarity = 0
    if (word.text === queryWord) similarity = 1
    else if (word.text.includes(queryWord)) similarity = 0.9
    else if (budget > 0) {
      const distance = boundedEditDistance(queryWord, word.text, budget)
      if (distance <= budget) similarity = 1 - distance / (queryWord.length + 1)
      else if (word.text.length > queryWord.length) {
        const head = boundedEditDistance(queryWord, word.text.slice(0, queryWord.length), budget)
        if (head <= budget) similarity = 0.8 * (1 - head / (queryWord.length + 1))
      }
    }
    if (similarity > 0 && (!best || similarity > best.similarity)) {
      best = { word, similarity }
      if (similarity === 1) break
    }
  }
  return best
}

export type MatchTextOptions = {
  /** When false, only exact and spacing tiers run. Callers run fuzzy only after that pass finds nothing. */
  fuzzy?: boolean
}

export function matchText(query: PreparedTextQuery, text: string, options: MatchTextOptions = {}): TextMatch | null {
  const exactAt = text.replace(/\s/g, ' ').toLowerCase().indexOf(query.phrase)
  if (exactAt >= 0) return { kind: 'exact', start: exactAt, end: exactAt + query.phrase.length, quality: 1 }
  const phraseIsSpaced = /\s/.test(text) && query.phrase.includes(' ')
  if (phraseIsSpaced) {
    const collapsed = collapseWhitespace(text)
    const at = collapsed.lower.indexOf(query.phrase)
    if (at >= 0) {
      const end = at + query.phrase.length
      return { kind: 'exact', start: collapsed.offsets[at], end: collapsed.offsets[end - 1] + 1, quality: 1 }
    }
  }
  const folded = foldText(text)
  if (query.compact.length >= MIN_SPACING_COMPACT_CHARS) {
    const at = folded.compact.indexOf(query.compact)
    if (at >= 0) {
      const end = at + query.compact.length
      return { kind: 'spacing', start: folded.offsets[at], end: folded.offsets[end - 1] + 1, quality: 0.9 }
    }
  }
  if (options.fuzzy === false) return null
  const compactLength = query.compact.length
  if (compactLength >= MIN_FUZZY_COMPACT_CHARS && compactLength <= MAX_FUZZY_COMPACT_CHARS) {
    const budget = editBudget(compactLength)
    const found = approximateSubstring(query.compact, folded.compact, budget)
    if (found) {
      const startIndex = Math.max(0, found.end - compactLength)
      return {
        kind: 'fuzzy',
        start: folded.offsets[startIndex],
        end: folded.offsets[found.end - 1] + 1,
        quality: 0.75 * (1 - found.distance / (compactLength + 1))
      }
    }
  }
  if (!query.words.length) return null
  const words = foldWords(text)
  let total = 0
  let first: Word | null = null
  for (const queryWord of query.words) {
    const hit = matchWord(queryWord, words)
    if (!hit) return null
    total += hit.similarity
    if (!first || hit.word.start < first.start) first = hit.word
  }
  return { kind: 'fuzzy', start: first!.start, end: first!.end, quality: 0.6 * (total / query.words.length) }
}

function collapseWhitespace(text: string): { lower: string; offsets: number[] } {
  let lower = ''
  const offsets: number[] = []
  let inSpace = false
  for (let i = 0; i < text.length; i += 1) {
    const isSpace = /\s/.test(text[i])
    if (isSpace && inSpace) continue
    inSpace = isSpace
    lower += isSpace ? ' ' : text[i].toLowerCase()
    offsets.push(i)
  }
  return { lower, offsets }
}

const MATCHED_TEXT_CHARS = 80

/** Hit fields telling the caller a result was not a literal match, and what text it matched. */
export function matchLabel(match: TextMatch, text: string): { match?: Exclude<TextMatchKind, 'exact'>; matched?: string } {
  if (match.kind === 'exact') return {}
  const matched = text.slice(match.start, Math.min(match.end, match.start + MATCHED_TEXT_CHARS)).replace(/\s+/g, ' ').trim()
  return { match: match.kind, ...(matched ? { matched } : {}) }
}
