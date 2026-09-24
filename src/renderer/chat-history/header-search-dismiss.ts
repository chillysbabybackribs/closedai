/**
 * When the header chat palette closes. Every path is a discrete, observable event rather than
 * pointer geometry: in Electron the native browser view swallows pointer moves, so "the pointer
 * left the popup" cannot be known reliably, and a stale hover flag was the root of the palette
 * closing on its own or refusing to close.
 */

export type NodeLike = { contains(node: NodeLike | null): boolean }

/**
 * Focus moved outside the component (Tab away, a click that focuses something else, or focus
 * leaving the document for a native view). Clicks inside the popup swallow their mousedown so
 * they never move focus, which keeps this the only focus-driven close.
 */
export function closesOnFocusOut(root: NodeLike, relatedTarget: NodeLike | null): boolean {
  return relatedTarget === null || !root.contains(relatedTarget)
}

/** A press outside the component closes it even when the press does not move focus. */
export function closesOnPointerDown(root: NodeLike, target: NodeLike | null): boolean {
  return target === null || !root.contains(target)
}

/**
 * Where the keyboard cursor lands after the list changes underneath it (a turn finishing moves a
 * chat between groups; a refresh adopts new threads). The selected chat keeps the cursor wherever
 * it moved to; only when it is gone does the cursor fall back to the first row.
 */
export function cursorIndex(ids: readonly string[], highlightId: string | null): number {
  if (highlightId === null) return 0
  const index = ids.indexOf(highlightId)
  return index === -1 ? 0 : index
}
