import { basename } from './drawer-format.js'
import type { DrawerRowModel } from './drawer-types.js'

export type ChatSearchHit = {
  row: DrawerRowModel
  titleRanges: Array<[number, number]>
  folder: string | null
  score: number
}

const DEFAULT_LIMIT = 8

export function searchChats(
  rows: DrawerRowModel[],
  query: string,
  limit: number = DEFAULT_LIMIT
): ChatSearchHit[] {
  const trimmed = query.trim()
  if (trimmed === '') return []

  const hits: ChatSearchHit[] = []
  for (const row of rows) {
    if (row.title.trim() === '' && !row.cwd) continue
    const folder = row.cwd === null ? null : basename(row.cwd)
    const titleMatch = matchSubsequence(row.title, trimmed)
    const folderMatch = folder === null ? null : matchSubsequence(folder, trimmed)
    if (titleMatch === null && folderMatch === null) continue

    const score = titleMatch !== null ? titleMatch.score : folderMatch!.score - 1000
    hits.push({ row, titleRanges: titleMatch?.ranges ?? [], folder, score })
  }

  hits.sort(
    (left, right) =>
      right.score - left.score ||
      right.row.updatedAt - left.row.updatedAt ||
      left.row.id.localeCompare(right.row.id)
  )
  return hits.slice(0, Math.max(0, limit))
}

type SubsequenceMatch = { score: number; ranges: Array<[number, number]> }

function matchSubsequence(text: string, query: string): SubsequenceMatch | null {
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const ranges: Array<[number, number]> = []
  let score = 0
  let cursor = 0
  let previousIndex = -2

  for (const character of needle) {
    if (character === ' ' || character === '\t') continue
    const index = haystack.indexOf(character, cursor)
    if (index === -1) return null

    if (index === previousIndex + 1) {
      score += 8
      ranges[ranges.length - 1]![1] = index + 1
    } else {
      score += 1
      if (isWordStart(haystack, index)) score += 6
      ranges.push([index, index + 1])
    }
    previousIndex = index
    cursor = index + 1
  }

  if (ranges.length === 0) return null
  score -= ranges[0]![0] * 0.5
  score -= (previousIndex - ranges[0]![0]) * 0.1
  return { score, ranges }
}

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true
  return /[^a-z0-9]/.test(text[index - 1]!)
}

export type TitleSegment = { text: string; matched: boolean }

export function segmentTitle(title: string, ranges: Array<[number, number]>): TitleSegment[] {
  if (ranges.length === 0) return [{ text: title, matched: false }]

  const segments: TitleSegment[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) {
      segments.push({ text: title.slice(cursor, start), matched: false })
    }
    segments.push({ text: title.slice(start, end), matched: true })
    cursor = end
  }
  if (cursor < title.length) {
    segments.push({ text: title.slice(cursor), matched: false })
  }
  return segments
}

export function stepHighlight(cursor: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (cursor + delta + count) % count
}
