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
/** Below any title score: the weakest title match is one character at the end of a long title. */
const PREVIEW_SCORE = -1_000_000

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

export type ChatActivityHit = ChatSearchHit & {
  status: 'running' | 'paused' | 'completed' | 'open' | 'closed'
  completedAt: number | null
}

export function activityAt(row: ChatRowSummary): number {
  return row.lastTurnEndedAt ?? row.updatedAt
}

/** The row's live state or, for idle chats, when it was last active. */
export function chatSearchWhen(hit: ChatActivityHit, formatTime: (ms: number) => string): string {
  return hit.status === 'completed' && hit.completedAt != null
    ? `Finished ${formatTime(hit.completedAt).toLowerCase()}`
    : hit.status === 'running' ? ''
      : hit.status === 'paused' ? 'Paused'
        : formatTime(activityAt(hit.row))
}

export function chatSearchPlace(hit: ChatActivityHit): 'Open' | 'Closed' | null {
  return hit.status === 'closed' ? 'Closed' : hit.status === 'open' ? 'Open' : null
}

export function chatSearchMeta(hit: ChatActivityHit, formatTime: (ms: number) => string): string {
  return [hit.folder, chatSearchPlace(hit), chatSearchWhen(hit, formatTime)].filter(Boolean).join(' · ')
}

export type ChatSearchSection = {
  label: string
  hits: ChatActivityHit[]
  /** How many chats belong to the group; larger than `hits.length` when the group is windowed. */
  total: number
}

export type ChatSearchLimits = {
  /** Ranked matches kept for a query. */
  query?: number
  /** Closed chats shown at rest. Live groups (running, paused, unread, open) are never windowed. */
  closed?: number
}

/**
 * Closed chats shown at rest. A workspace accumulates hundreds of closed chats; painting them all
 * on every open is what made the palette and the History view slow, and nobody scrolls that far:
 * older chats are reached by typing, or paged in the History view.
 */
export const REST_CLOSED_LIMIT = 20

const compareActivity = (a: ChatActivityHit, b: ChatActivityHit): number =>
  activityAt(b.row) - activityAt(a.row) || a.row.paneId.localeCompare(b.row.paneId)

/**
 * Activity is never displaced by newer history; title queries retain their relevance ranking.
 * Live groups are complete. Closed is a window of the newest chats and carries its full count,
 * so the caption can say how much history lies beyond it.
 */
export function chatSearchView(rows: ChatRowSummary[], query: string, reviews: ChatReviewQueue, limits: ChatSearchLimits = {}): {
  sections: ChatSearchSection[]
  runningCount: number
  unreadCount: number
  /** Listed chats before any window was applied. */
  total: number
} {
  const withActivity = (hit: ChatSearchHit): ChatActivityHit => {
    const review = reviews[hit.row.paneId]
    const unread = review?.viewedAt === null
    return {
      ...hit,
      status: hit.row.running ? 'running' : hit.row.paused ? 'paused' : unread ? 'completed'
        : hit.row.attached ? 'open' : 'closed',
      completedAt: unread ? review.queuedAt : null
    }
  }
  const section = (label: string, hits: ChatActivityHit[], total = hits.length): ChatSearchSection => ({ label, hits, total })
  const window = (hits: ChatActivityHit[], limit: number): ChatActivityHit[] => hits.slice(0, Math.max(0, limit))
  const recent = rankChats(rows, '').map(withActivity)
  const running = recent.filter(hit => hit.status === 'running')
  const completed = recent.filter(hit => hit.status === 'completed')
    .sort((a, b) => b.completedAt! - a.completedAt! || a.row.paneId.localeCompare(b.row.paneId))
  const open = recent.filter(hit => hit.status === 'open').sort(compareActivity)
  const closed = recent.filter(hit => hit.status === 'closed').sort(compareActivity)
  const matches = query.trim() ? rankChats(rows, query).map(withActivity) : null
  const sections = matches
    ? [section('Matching chats', window(matches, limits.query ?? Infinity), matches.length)]
    : [
        section('Running', running),
        section('Paused', recent.filter(hit => hit.status === 'paused')),
        section('Recently completed', completed),
        section('Open', open),
        section('Closed', window(closed, limits.closed ?? REST_CLOSED_LIMIT), closed.length)
      ]
  return {
    sections: sections.filter(section => section.hits.length > 0),
    runningCount: running.length,
    unreadCount: completed.length,
    total: matches ? matches.length : recent.length
  }
}

/** The palette footer: how much of history the list shows, and how to reach the rest. */
export function chatSearchFooter(listed: number, total: number, searching: boolean): string {
  const plural = searching ? 'matches' : 'chats'
  if (total > listed) return `${listed} of ${total} ${plural}${searching ? '' : ' · type to search older'}`
  return `${listed} ${listed === 1 ? (searching ? 'match' : 'chat') : plural}`
}

export function searchChats(
  rows: ChatRowSummary[],
  query: string,
  limit: number = DEFAULT_LIMIT
): ChatSearchHit[] {
  return rankChats(rows, query).slice(0, Math.max(0, limit))
}

/** Every listable hit for the query, best first; an empty query is history newest first. */
export function rankChats(rows: ChatRowSummary[], query: string): ChatSearchHit[] {
  const trimmed = query.trim()
  const listable = rows.filter(listableChat)
  if (trimmed === '') return sortByActivity(listable)
    .map(row => ({ row, titleRanges: [], folder: basename(row.cwd), score: 0 }))

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
    if (row.preview.toLowerCase().includes(needle)) hits.push({ row, titleRanges: [], folder, score: PREVIEW_SCORE })
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
