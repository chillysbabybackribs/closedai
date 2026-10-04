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
  for (const area of geometry.scrollAreas) {
    const host = canvas.querySelector(`[data-side-scroll="${escapeSelector(area.id)}"]`) as HTMLElement | null
    if (host) {
      applyRect(host, area.rect)
      const content = host.firstElementChild as HTMLElement | null
      if (content) content.style.height = `${area.contentHeight}px`
    }
  }
  for (const { id, rect } of geometry.panes) {
    const tile = layoutTileElement(canvas, id)
    const area = geometry.scrollAreas.find((area) => area.paneIds.includes(id))
    if (tile) applyRect(tile, area ? { ...rect, x: rect.x - area.rect.x, y: rect.y - area.rect.y } : rect)
  }
  for (const { id, rect } of geometry.dividers) {
    const divider = canvas.querySelector(
      `[data-ui="layout.divider"][data-ui-key="${escapeSelector(id)}"]`
    ) as HTMLElement | null
    if (divider) applyRect(divider, rect)
  }
}
