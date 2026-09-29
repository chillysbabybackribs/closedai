import type { AppWindowId } from './app-windows.js'

/** Drop target shared across processes; mirrors the canvas window-target model. */
export type SerializedWindowTarget =
  | { kind: 'free' }
  | { kind: 'maximize' }
  | { kind: 'split'; target: string; edge: 'left' | 'right' | 'top' | 'bottom' }
  | { kind: 'group'; target: string }

export type CrossWindowDockHover = {
  sourceWindowId: AppWindowId
  sourcePaneId: string
  tabIds: string[]
  ghostTabLabel: string
  /** Pointer position on this window's layout canvas, CSS pixels. */
  x: number
  y: number
}

export type CrossWindowDockRouteRequest = {
  screenX: number
  screenY: number
  source: { paneId: string; tabIds: string[]; ghostTabLabel: string }
}

export type CrossWindowDockRouteResult = {
  /** Another window is receiving the hover preview. */
  targetWindowId: AppWindowId | null
  /** Canvas coordinates on the target window when `targetWindowId` is set. */
  foreign?: { x: number; y: number }
  /** When the pointer is still over the source canvas, local snap targets. */
  local: { x: number; y: number; target: SerializedWindowTarget } | null
}

export type CrossWindowDockComplete = {
  targetWindowId: AppWindowId
  source: { paneId: string; tabIds: string[] }
}

export type AppWindowDockEvent =
  | { type: 'hover'; hover: CrossWindowDockHover | null }
  | { type: 'absorb'; payload: { paneId: string; tabIds: string[]; target: SerializedWindowTarget } }
