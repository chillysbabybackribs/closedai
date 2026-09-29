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

/** Pick the topmost registered window whose dock surface contains the screen point. */
export function pickDockTarget(frames: readonly DockWindowFrame[], screenX: number, screenY: number,
  skipId?: AppWindowId): { windowId: AppWindowId; x: number; y: number } | null {
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index]!
    if (frame.id === skipId) continue
    const point = screenToCanvas(frame, screenX, screenY)
    if (point) return { windowId: frame.id, x: point.x, y: point.y }
  }
  return null
}

function overlapArea(a: Rectangle, b: Rectangle): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > left && bottom > top ? (right - left) * (bottom - top) : 0
}

function overlapCenter(a: Rectangle, b: Rectangle): { x: number; y: number } | null {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= left || bottom <= top) return null
  return { x: (left + right) / 2, y: (top + bottom) / 2 }
}

/**
 * Map a cross-window drag to a target canvas point. The pointer usually stays on the moving
 * window, so when it does not hit another surface we use the overlap center with the largest area.
 */
export function pickCrossDockTarget(sourceId: AppWindowId, frames: readonly DockWindowFrame[], screenX: number, screenY: number):
  { windowId: AppWindowId; x: number; y: number } | null {
  const pointer = pickDockTarget(frames, screenX, screenY, sourceId)
  if (pointer) return pointer
  const source = frames.find((frame) => frame.id === sourceId)
  if (!source) return null
  let best: { windowId: AppWindowId; x: number; y: number; area: number } | null = null
  for (const frame of frames) {
    if (frame.id === sourceId || !frame.surface) continue
    const center = overlapCenter(source.content, frame.content)
    if (!center) continue
    const mapped = screenToCanvas(frame, center.x, center.y)
    if (!mapped) continue
    const area = overlapArea(source.content, frame.content)
    if (!best || area > best.area) best = { windowId: frame.id, x: mapped.x, y: mapped.y, area }
  }
  return best ? { windowId: best.windowId, x: best.x, y: best.y } : null
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
