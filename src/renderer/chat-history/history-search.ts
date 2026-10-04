import { basename } from './history-format.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'

export type ChatSearchHit = {
  row: ChatRowSummary
  titleRanges: Array<[number, number]>
  folder: string | null
  score: number
}

const DEFAULT_LIMIT = 8
/** Below any title score: the weakest title match is one character at the end of a long title. */
const PREVIEW_SCORE = -1_000_000
/** Folder-only matches follow preview matches and retain activity ordering. */
const FOLDER_SCORE = PREVIEW_SCORE - 1

/**
 * One visibility rule for every chat-history surface. The main process already withholds blank,
 * detached, unpinned records; this hides the blank panes it keeps (open "New chat" tabs) unless
 * they are running or continue another chat, so header search and the History view list the
 * same chats.
 */
export function listableChat(row: ChatRowSummary): boolean {
  return Boolean(row.threadId || row.preview || row.running || row.continuedFrom)
}

/** Newest activity first; the same order on every surface. */
export function sortByActivity(rows: readonly ChatRowSummary[]): ChatRowSummary[] {
  return rows.slice().sort((a, b) => activityAt(b) - activityAt(a) || a.paneId.localeCompare(b.paneId))
}

export function activityAt(row: ChatRowSummary): number {
  return row.lastTurnEndedAt ?? row.updatedAt
}

export function searchChats(
  rows: ChatRowSummary[],
  query: string,
  limit: number = DEFAULT_LIMIT
): ChatSearchHit[] {
  return rankChats(rows, query).slice(0, Math.max(0, limit))
}

function chatHit(row: ChatRowSummary, titleRanges: Array<[number, number]> = [], score = 0): ChatSearchHit {
  return { row, titleRanges, folder: row.cwd === null ? null : basename(row.cwd), score }
}

/** Open desk rows in stable open order; optional query filters without resorting by activity. */
export function openDeskSearchHits(
  rows: readonly ChatRowSummary[],
  openDeskChatIds: readonly string[],
  query: string
): ChatSearchHit[] {
  const byId = new Map(rows.map((row) => [row.paneId, row]))
  const hits: ChatSearchHit[] = []
  for (const paneId of openDeskChatIds) {
    const row = byId.get(paneId)
    if (!row || !listableChat(row)) continue
    const match = query.trim() === '' ? chatHit(row) : rankChats([row], query)[0]
    if (match) hits.push(match)
  }
  return hits
}

export function rankChatsExcluding(
  rows: ChatRowSummary[],
  query: string,
  excludePaneIds: ReadonlySet<string>
): ChatSearchHit[] {
  return rankChats(rows, query).filter((hit) => !excludePaneIds.has(hit.row.paneId))
}

/** Every listable hit for the query, best first; an empty query is history newest first. */
export function rankChats(rows: ChatRowSummary[], query: string): ChatSearchHit[] {
  const trimmed = query.trim()
  const listable = rows.filter(listableChat)
  if (trimmed === '') return sortByActivity(listable).map((row) => chatHit(row))

  const needle = trimmed.toLowerCase()
  const hits: ChatSearchHit[] = []
  for (const row of listable) {
    const folder = row.cwd === null ? null : basename(row.cwd)
    const titleMatch = row.title.trim() === '' ? null : matchSubsequence(row.title, trimmed)
    if (titleMatch) {
      hits.push({ row, titleRanges: titleMatch.ranges, folder, score: titleMatch.score })
      continue
    }
    // A chat is also findable by what was said in it; such hits rank below every title match.
    if (row.preview.toLowerCase().includes(needle)) {
      hits.push({ row, titleRanges: [], folder, score: PREVIEW_SCORE })
    } else if (folder?.toLowerCase().includes(needle)) {
      hits.push({ row, titleRanges: [], folder, score: FOLDER_SCORE })
    }
  }

  hits.sort(
    (left, right) =>
      right.score - left.score ||
      activityAt(right.row) - activityAt(left.row) ||
      left.row.paneId.localeCompare(right.row.paneId)
  )
  return hits
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
