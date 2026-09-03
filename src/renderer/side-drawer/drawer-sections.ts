import { basename } from './drawer-format.js'
import type { DrawerReviewQueue } from './drawer-review-queue.js'
import type { DirectoryGroup, DrawerRowModel, DrawerSections } from './drawer-types.js'

export function rowIsLive(row: DrawerRowModel): boolean {
  return row.running || row.status === 'running' || row.status === 'queued'
}

/**
 * The row the user is looking at. Open panes are identified by pane, history records by thread:
 * matching thread ids on a pane row marks every threadless "New chat" as current the moment the
 * selected chat has no thread of its own yet, which is most of a fresh chat's life.
 */
export function rowIsCurrent(
  row: DrawerRowModel,
  selectedPaneId: string | null,
  activeThreadId: string | null
): boolean {
  if (row.paneId !== undefined) return row.paneId === selectedPaneId
  return row.threadId !== null && row.threadId === activeThreadId
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
 * Current is strictly active work. Completed panes stay in the review section until their reviewed
 * grace period expires; every other idle pane joins History alongside provider thread records.
 */
export function buildDrawerSections(rows: DrawerRowModel[], reviewQueue: DrawerReviewQueue): DrawerSections {
  const current: DrawerRowModel[] = []
  const review: DrawerRowModel[] = []
  const history: DrawerRowModel[] = []

  for (const row of rows) {
    if (row.paneId === undefined) history.push(row)
    else if (subtreeIsLive(row)) current.push(row)
    else if (reviewQueue[row.id] !== undefined) review.push(row)
    else history.push(row)
  }
  review.sort((a, b) => (reviewQueue[b.id]?.queuedAt ?? 0) - (reviewQueue[a.id]?.queuedAt ?? 0))

  return { current, reviewQueue: review, history }
}
