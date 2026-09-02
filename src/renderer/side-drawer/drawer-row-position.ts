export type MenuBox = { width: number; maxHeight: number }
export type Viewport = { width: number; height: number }
export type MenuPlacement = { left: number; top: number; maxHeight: number }
export type RowMenuBounds = { right: number; top: number }

const EDGE_GAP = 8
const ANCHOR_GAP = 4

export function rowMenuAnchor(bounds: RowMenuBounds): { x: number; y: number } {
  return { x: bounds.right, y: bounds.top }
}

export function placeRowMenu(
  anchor: { x: number; y: number },
  menu: MenuBox,
  viewport: Viewport
): MenuPlacement {
  const spaceBelow = viewport.height - anchor.y - ANCHOR_GAP - EDGE_GAP
  const spaceAbove = anchor.y - ANCHOR_GAP - EDGE_GAP
  const flip = spaceBelow < menu.maxHeight && spaceAbove > spaceBelow
  const available = Math.max(0, flip ? spaceAbove : spaceBelow)
  const height = Math.min(menu.maxHeight, available)
  const top = flip ? anchor.y - ANCHOR_GAP - height : anchor.y + ANCHOR_GAP

  const overflowsRight = anchor.x + ANCHOR_GAP + menu.width + EDGE_GAP > viewport.width
  const left = overflowsRight
    ? Math.max(EDGE_GAP, anchor.x - ANCHOR_GAP - menu.width)
    : anchor.x + ANCHOR_GAP
  return {
    left,
    top: Math.max(EDGE_GAP, top),
    maxHeight: Math.max(0, height)
  }
}
