import { BROWSER_PANE_ID, type Rect, type layoutGeometry } from './layout-tree.js'

type Geometry = ReturnType<typeof layoutGeometry>

function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function applyRect(element: HTMLElement, rect: Rect): void {
  element.style.left = `${rect.x}px`
  element.style.top = `${rect.y}px`
  element.style.width = `${rect.width}px`
  element.style.height = `${rect.height}px`
}

export function layoutTileElement(canvas: HTMLElement, paneId: string): HTMLElement | null {
  if (paneId === BROWSER_PANE_ID) {
    return canvas.querySelector('.chat-layout-tile[aria-label="Browser"]')
  }
  return canvas.querySelector(`[data-pane-id="${escapeSelector(paneId)}"]`)
    ?? canvas.querySelector(`[data-view-id="${escapeSelector(paneId)}"]`)
}

/** Paint computed layout rects without a React commit — used while a split divider is dragged. */
export function applyLayoutGeometryDom(canvas: HTMLElement, geometry: Geometry): void {
  for (const { id, rect } of geometry.panes) {
    const tile = layoutTileElement(canvas, id)
    if (tile) applyRect(tile, rect)
  }
  for (const rail of geometry.rails) {
    for (const [attribute, rect] of [['data-dock-rail', rail.rect], ['data-dock-boundary', rail.boundary]] as const) {
      const element = canvas.querySelector(`[${attribute}="${escapeSelector(rail.id)}"]`) as HTMLElement | null
      if (element) applyRect(element, rect)
    }
  }
  for (const { id, rect } of geometry.dividers) {
    const divider = canvas.querySelector(
      `[data-ui="layout.divider"][data-ui-key="${escapeSelector(id)}"]`
    ) as HTMLElement | null
    if (divider) applyRect(divider, rect)
  }
}
