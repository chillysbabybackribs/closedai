import type { AppWindowId, AppWindowRegion } from '../../shared/app-windows.js'
import type { CrossWindowDockComplete, CrossWindowDockRouteRequest, CrossWindowDockRouteResult } from '../../shared/cross-window-dock.js'

export type DockWindowFrame = {
  id: AppWindowId
  content: Rectangle
  surface: AppWindowRegion | null
}

type Rectangle = { x: number; y: number; width: number; height: number }

export function screenToCanvas(frame: DockWindowFrame, screenX: number, screenY: number): { x: number; y: number } | null {
  const { content, surface } = frame
  if (!surface) return null
  const localX = screenX - content.x
  const localY = screenY - content.y
  if (localX < 0 || localY < 0 || localX > content.width || localY > content.height) return null
  const x = localX - surface.x
  const y = localY - surface.y
  return x >= 0 && y >= 0 && x <= surface.width && y <= surface.height ? { x, y } : null
}

function contains(rect: Rectangle, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height
}

/**
 * Map a tile drag to another window's canvas point. The pointer has to be over that window with
 * nothing in front of it: `frames` run back to front, so when the first window under the pointer
 * is the source (the dragging window is focused, so usually frontmost) the drag stays local.
 */
export function pickCrossDockTarget(sourceId: AppWindowId, frames: readonly DockWindowFrame[], screenX: number, screenY: number):
  { windowId: AppWindowId; x: number; y: number } | null {
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index]!
    if (!contains(frame.content, screenX, screenY)) continue
    if (frame.id === sourceId) return null
    const point = screenToCanvas(frame, screenX, screenY)
    return point ? { windowId: frame.id, x: point.x, y: point.y } : null
  }
  return null
}

export function routeCrossDock(sourceId: AppWindowId, frames: readonly DockWindowFrame[],
  request: CrossWindowDockRouteRequest): CrossWindowDockRouteResult {
  const self = frames.find((frame) => frame.id === sourceId)
  const localPoint = self ? screenToCanvas(self, request.screenX, request.screenY) : null
  const foreign = pickCrossDockTarget(sourceId, frames, request.screenX, request.screenY)
  if (foreign) return { targetWindowId: foreign.windowId, foreign: { x: foreign.x, y: foreign.y }, local: null }
  return { targetWindowId: null, local: localPoint ? { x: localPoint.x, y: localPoint.y, target: { kind: 'free' } } : null }
}

export function tabsForComplete(sourceTabs: readonly string[], payload: CrossWindowDockComplete): string[] {
  return payload.source.tabIds.filter((id) => sourceTabs.includes(id))
}
