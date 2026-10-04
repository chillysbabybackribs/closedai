/** Assign sequence numbers when chats newly appear on the desk; drop ids that left the layout. */
export function syncDeskOpenedAt(
  current: Record<string, number>,
  openIds: readonly string[],
  nextSequence: () => number
): Record<string, number> {
  const openSet = new Set(openIds)
  let next = current
  for (const id of openIds) {
    if (id in next) continue
    if (next === current) next = { ...current }
    next[id] = nextSequence()
  }
  for (const id of Object.keys(next)) {
    if (openSet.has(id)) continue
    if (next === current) next = { ...current }
    delete next[id]
  }
  return next
}

/** Newest opened first; tie-break on pane id so equal slots never swap while turns finish. */
export function sortDeskOpenIds(openIds: readonly string[], openedAt: Record<string, number>): string[] {
  return openIds.slice().sort(
    (left, right) => (openedAt[right] ?? 0) - (openedAt[left] ?? 0) || left.localeCompare(right)
  )
}
