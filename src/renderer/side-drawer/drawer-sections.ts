import { basename } from './drawer-format.js'
import type { DrawerReviewQueue } from './drawer-review-queue.js'
import type { DirectoryGroup, DrawerRowModel, DrawerSections } from './drawer-types.js'

export function rowIsLive(row: DrawerRowModel): boolean {
  return row.running || row.status === 'running' || row.status === 'queued'
}

/** The row the user is looking at: the one whose chat id is the selected pane's id. */
export function rowIsCurrent(row: DrawerRowModel, selectedPaneId: string | null): boolean {
  return selectedPaneId !== null && row.id === selectedPaneId
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

/**
 * Current is strictly active work, newest chat first — ordered by when the chat was created, not
 * by its streaming activity time, so rows do not reshuffle on every token. Completed chats stay
 * in the review section until their reviewed grace period expires, whether or not they still have
 * a pane; every other chat is History. Selection plays no part in placement.
 */
export function buildDrawerSections(rows: DrawerRowModel[], reviewQueue: DrawerReviewQueue): DrawerSections {
  const current: DrawerRowModel[] = []
  const review: DrawerRowModel[] = []
  const history: DrawerRowModel[] = []

  for (const row of rows) {
    if (subtreeIsLive(row)) current.push(row)
    else if (reviewQueue[row.id] !== undefined) review.push(row)
    else history.push(row)
  }
  current.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt)
  review.sort((a, b) => (reviewQueue[b.id]?.queuedAt ?? 0) - (reviewQueue[a.id]?.queuedAt ?? 0))
  history.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  return { current, reviewQueue: review, history }
}
