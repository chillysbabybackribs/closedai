import { basename } from './drawer-format.js'
import type { DrawerReviewQueue } from './drawer-review-queue.js'
import type { DirectoryGroup, DrawerRowModel, DrawerSections } from './drawer-types.js'

export const COMPLETION_DECAY_MS = 20 * 60 * 1000

export function rowIsLive(row: DrawerRowModel): boolean {
  return row.running || row.status === 'running' || row.status === 'queued'
}

export function subtreeIsLive(row: DrawerRowModel, seen = new Set<string>()): boolean {
  if (seen.has(row.id)) return false
  seen.add(row.id)
  if (rowIsLive(row)) return true
  return row.children.some((child) => subtreeIsLive(child, seen))
}

export function countLiveRows(rows: DrawerRowModel[], seen = new Set<string>()): number {
  let count = 0
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    if (rowIsLive(row)) count += 1
    count += countLiveRows(row.children, seen)
  }
  return count
}

export function splitChildren(
  row: DrawerRowModel
): { live: DrawerRowModel[]; settled: DrawerRowModel[] } {
  const live: DrawerRowModel[] = []
  const settled: DrawerRowModel[] = []
  for (const child of row.children) {
    if (subtreeIsLive(child)) live.push(child)
    else settled.push(child)
  }
  return { live, settled }
}

export function groupByDirectory(rows: DrawerRowModel[]): DirectoryGroup[] {
  const groups = new Map<string, DirectoryGroup>()
  for (const row of rows) {
    const cwd = row.cwd
    const key = cwd ?? '\u0000none'
    let group = groups.get(key)
    if (!group) {
      group = { key, label: cwd ? basename(cwd) : 'No folder', fullPath: cwd, rows: [] }
      groups.set(key, group)
    }
    group.rows.push(row)
  }
  const ordered = [...groups.values()]
  const noFolder = ordered.findIndex((group) => group.fullPath === null)
  if (noFolder !== -1 && ordered.length > 1) {
    ordered.push(...ordered.splice(noFolder, 1))
  }
  return ordered
}

export function buildDrawerSections(
  rows: DrawerRowModel[],
  reviewQueue: DrawerReviewQueue,
  recentlyCompleted: Record<string, number>,
  now: number = Date.now()
): DrawerSections {
  const running: DrawerRowModel[] = []
  const review: DrawerRowModel[] = []
  const recent: DrawerRowModel[] = []
  const completed: DrawerRowModel[] = []
  const history: DrawerRowModel[] = []

  for (const row of rows) {
    if (subtreeIsLive(row) || row.completedUnviewed) {
      running.push(row)
    } else if (reviewQueue[row.id] !== undefined || (row.threadId && reviewQueue[row.threadId] !== undefined)) {
      review.push(row)
    } else if (
      recentlyCompleted[row.id] !== undefined &&
      now - recentlyCompleted[row.id]! < COMPLETION_DECAY_MS
    ) {
      recent.push(row)
    } else if (row.status === 'done' || row.status === 'failed' || row.status === 'stopped') {
      completed.push(row)
    } else {
      history.push(row)
    }
  }

  return {
    running,
    reviewQueue: review,
    recentlyCompleted: recent,
    completed,
    history
  }
}
