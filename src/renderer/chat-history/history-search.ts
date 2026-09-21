import { basename } from './history-format.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatReviewQueue } from './review-queue.js'

export type ChatSearchHit = {
  row: ChatRowSummary
  titleRanges: Array<[number, number]>
  folder: string | null
  score: number
}

const DEFAULT_LIMIT = 8

export type ChatActivityHit = ChatSearchHit & {
  status: 'running' | 'paused' | 'completed' | 'history'
  completedAt: number | null
}

export type ChatSearchSection = {
  label: string
  hits: ChatActivityHit[]
}

/** Activity is never displaced by newer history; title queries retain their relevance ranking. */
export function chatSearchView(rows: ChatRowSummary[], query: string, reviews: ChatReviewQueue): {
  sections: ChatSearchSection[]
  runningCount: number
  unreadCount: number
} {
  const withActivity = (hit: ChatSearchHit): ChatActivityHit => {
    const review = reviews[hit.row.paneId]
    const unread = review?.viewedAt === null
    return {
      ...hit,
      status: hit.row.running ? 'running' : hit.row.paused ? 'paused' : unread ? 'completed' : 'history',
      completedAt: unread ? review.queuedAt : null
    }
  }
  const recent = searchChats(rows, '', rows.length).map(withActivity)
  const running = recent.filter(hit => hit.status === 'running')
  const completed = recent.filter(hit => hit.status === 'completed')
    .sort((a, b) => b.completedAt! - a.completedAt! || a.row.paneId.localeCompare(b.row.paneId))
  const sections = query.trim()
    ? [{ label: 'Matching chats', hits: searchChats(rows, query).map(withActivity) }]
    : [
        { label: 'Running', hits: running },
        { label: 'Paused', hits: recent.filter(hit => hit.status === 'paused') },
        { label: 'Recently completed', hits: completed },
        { label: 'History', hits: recent.filter(hit => hit.status === 'history').slice(0, DEFAULT_LIMIT) }
      ]
  return {
    sections: sections.filter(section => section.hits.length > 0),
    runningCount: running.length,
    unreadCount: completed.length
  }
}

export function searchChats(
  rows: ChatRowSummary[],
  query: string,
  limit: number = DEFAULT_LIMIT
): ChatSearchHit[] {
  const trimmed = query.trim()
  if (trimmed === '') return rows
    .filter(row => row.threadId || row.preview || row.running)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt || a.paneId.localeCompare(b.paneId))
    .slice(0, Math.max(0, limit))
    .map(row => ({ row, titleRanges: [], folder: basename(row.cwd), score: 0 }))

  const hits: ChatSearchHit[] = []
  for (const row of rows) {
    if (row.title.trim() === '') continue
    const folder = row.cwd === null ? null : basename(row.cwd)
    const titleMatch = matchSubsequence(row.title, trimmed)
    if (titleMatch === null) continue

    const score = titleMatch.score
    hits.push({ row, titleRanges: titleMatch?.ranges ?? [], folder, score })
  }

  hits.sort(
    (left, right) =>
      right.score - left.score ||
      right.row.updatedAt - left.row.updatedAt ||
      left.row.paneId.localeCompare(right.row.paneId)
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
