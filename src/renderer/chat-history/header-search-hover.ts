export type Box = { left: number; top: number; right: number; bottom: number }
export type Point = { x: number; y: number }

const within = (point: Point, box: Box): boolean =>
  point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom

/**
 * Whether a pointer position still counts as hovering the search: over the field, over the
 * popup, or in the band between them across the popup's full width. Geometry rather than DOM
 * boundary events because the popup is wider than the field, and because in Electron a native
 * browser view can sit over part of the popup until the freeze still lands — the renderer sees a
 * leave at that edge although the pointer never left the popup's box.
 */
export function pointerKeepsSearchOpen(point: Point, field: Box, popup: Box | null): boolean {
  if (within(point, field)) return true
  if (!popup) return false
  if (within(point, popup)) return true
  return within(point, { left: popup.left, right: popup.right, top: field.bottom, bottom: popup.top })
}
