import { useCallback, useRef } from 'react'
import type { DragDropTarget } from '../layout-drag-preview.js'
import { BROWSER_PANE_ID, type ChatLayout, type Rect } from '../layout-tree.js'
import { tabOwner } from '../layout-tabs.js'
import { tabTearOffRect, tearOffTab } from './window-arrange.js'
import { clampWindow, windowMinimum } from './window-layout.js'
import type { WindowFrame } from './use-window-drag.js'

// A conversation tab dragged over free space (or a floating window's body) tears off into its own
// floating window where it is released. The outline follows the pointer outside React, like a
// window move, so transcripts do not re-render per dragover.

/** The drop target for free space; never a pane id. */
export const TEAR_OFF_TARGET = 'window:tear-off'

export function useTabTearOff(frame: () => WindowFrame, change: (update: (tree: ChatLayout) => ChatLayout) => void) {
  const rect = useRef<Rect | null>(null)
  const outline = useRef<HTMLDivElement>(null)

  /** The tear-off target for a tab of a chat window at canvas `x`, `y`; null for anything else. */
  const at = useCallback((dragging: { id: string; singleTab: boolean } | null, x: number, y: number): DragDropTarget | null => {
    rect.current = null
    const { tree, size, tiled, floating } = frame()
    const owner = dragging?.singleTab ? tabOwner(tree, dragging.id) : null
    const floats = floating.find((tile) => tile.id === owner)
    const source = floats ?? tiled.find((tile) => tile.id === owner)
    if (!dragging || !source || owner === BROWSER_PANE_ID) return null
    const next = clampWindow(tabTearOffRect(source.rect, Boolean(floats), size, { x, y }, dragging.id), size, windowMinimum(dragging.id))
    rect.current = next
    const box = outline.current?.style
    if (box) Object.assign(box, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.width}px`, height: `${next.height}px` })
    return { target: TEAR_OFF_TARGET, edge: null }
  }, [frame])

  /** Open `id` in its own window at the last tracked rect; false when there is none. */
  const commit = useCallback((id: string): boolean => {
    const next = rect.current
    rect.current = null
    if (!next) return false
    const { tiled } = frame()
    change((tree) => tearOffTab(tree, id, next, tiled, crypto.randomUUID()))
    return true
  }, [frame, change])

  return { at, commit, rect, outline }
}
