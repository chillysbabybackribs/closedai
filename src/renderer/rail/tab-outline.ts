// The outline shared by the desktop's two rails: a strip along one window edge with a tab bulging
// out of it around a group of controls (the dock's tray at the bottom, chat search at the top).

export type TabOutlineBox = {
  /** The surface's box: the rail's width, the strip plus the tab's reach. */
  width: number
  height: number
  /** The tab's left edge and width, measured from what it holds. */
  tabLeft: number
  tabWidth: number
}

export type TabShape = {
  /** Thickness of the strip along the window edge. */
  strip: number
  /** The tab's outer corners and the concave joins where it leaves the strip. */
  radius: number
  fillet: number
  /** `up` for a rail on the bottom edge (the tab rises), `down` for one on the top edge. */
  opens: 'up' | 'down'
}

/**
 * SVG path of the strip and its tab as one shape: along the strip's inner edge, a concave join out
 * into the tab, round its far corners, and back. `inset` pulls the line in (0.5 centres a 1px
 * stroke on the edge); `closed` runs on round the strip's window edge so the path can clip the fill.
 * When the tab is shallower than the two curves, they meet directly as an S with no straight side.
 * Worked out for a tab that rises; a tab that drops is the same path mirrored top to bottom.
 */
export function tabOutlinePath(box: TabOutlineBox, shape: TabShape, inset = 0, closed = false): string {
  const flip = shape.opens === 'down'
  const n = (value: number): string => String(Math.round(value * 100) / 100)
  const point = (x: number, y: number): string => `${n(x)} ${n(flip ? box.height - y : y)}`
  const arc = (radius: number, sweep: 0 | 1, x: number, y: number): string =>
    `A ${n(radius)} ${n(radius)} 0 0 ${flip ? 1 - sweep : sweep} ${point(x, y)}`
  const top = inset
  const edge = box.height - shape.strip + inset
  const r = Math.max(shape.radius - inset, 0)
  const f = shape.fillet + inset
  // Left join, from the corner's centre: the fillet's centre sits `f` above the edge, `r + f` away.
  const cornerX = box.tabLeft + inset + r
  const cornerY = top + r
  const dy = (edge - f) - cornerY
  const dx = dy >= 0 ? r + f : Math.sqrt((r + f) ** 2 - dy ** 2)
  const filletX = cornerX - dx
  const side = dy >= 0
    ? { from: [cornerX - r, edge - f], to: [cornerX - r, cornerY] }
    : (() => { const t = f / (r + f); const p = [filletX + dx * t, edge - f - dy * t]; return { from: p, to: p } })()
  const mirror = (x: number): number => 2 * (box.tabLeft + box.tabWidth / 2) - x
  const path = [
    `M ${point(0, edge)}`, `H ${n(filletX)}`,
    arc(f, 0, side.from[0], side.from[1]), `L ${point(side.to[0], side.to[1])}`,
    arc(r, 1, cornerX, top), `H ${n(mirror(cornerX))}`,
    arc(r, 1, mirror(side.to[0]), side.to[1]), `L ${point(mirror(side.from[0]), side.from[1])}`,
    arc(f, 0, mirror(filletX), edge), `H ${n(box.width)}`
  ]
  if (closed) path.push(`V ${n(flip ? 0 : box.height)}`, 'H 0', 'Z')
  return path.join(' ')
}
