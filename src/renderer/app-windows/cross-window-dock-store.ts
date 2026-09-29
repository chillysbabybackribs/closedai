import { useSyncExternalStore } from 'react'
import type { CrossWindowDockHover } from '../../shared/cross-window-dock.js'

let hover: CrossWindowDockHover | null = null
let canvasSize = { width: 1280, height: 800 }
const listeners = new Set<() => void>()

export function setCrossWindowDockHover(next: CrossWindowDockHover | null): void {
  hover = next
  for (const listener of listeners) listener()
}

export function useCrossWindowDockHover(): CrossWindowDockHover | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => hover)
}

export function setCrossWindowDockCanvasSize(size: { width: number; height: number }): void {
  canvasSize = size
}

export function crossWindowDockCanvasSize(): { width: number; height: number } {
  return canvasSize
}
