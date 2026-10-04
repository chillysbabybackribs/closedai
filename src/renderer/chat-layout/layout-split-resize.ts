import { BROWSER_PANE_ID, layoutGeometry, removePane, unprunedRatio, type ChatLayout, type SplitRatioOverrides } from './layout-tree.js'
import { outOfTiledLayer } from './layout-docking.js'
import { applyLayoutGeometryDom } from './layout-geometry-dom.js'

/**
 * The ratio to store for a divider let go at `shown`. Hidden, minimized and floating windows are
 * pruned before layout, which re-weights their row; this undoes both prunes in the order they apply.
 */
export function storedSplitRatio(tree: ChatLayout, id: string, shown: number, browserVisible: boolean): number {
  const visible = browserVisible ? tree : removePane(tree, BROWSER_PANE_ID)
  const tiled = visible ? unprunedRatio(visible, outOfTiledLayer, id, shown) : shown
  return browserVisible ? tiled : unprunedRatio(tree, (pane) => pane.id === BROWSER_PANE_ID, id, tiled)
}

export type SplitResizeLive = {
  active: boolean
  ratio: { id: string; ratio: number } | null
}

export type SplitResizeFrame = {
  tree: ChatLayout
  browserVisible: boolean
  width: number
  height: number
}

export function paintSplitResize(
  canvas: HTMLElement | null,
  live: SplitResizeLive,
  frame: SplitResizeFrame
): void {
  if (!canvas || !live.active || !live.ratio) return
  const visibleTree = frame.browserVisible ? frame.tree : removePane(frame.tree, BROWSER_PANE_ID)
  const overrides: SplitRatioOverrides = { [live.ratio.id]: live.ratio.ratio }
  applyLayoutGeometryDom(canvas, layoutGeometry(visibleTree, frame.width, frame.height, overrides))
}

export function createSplitResizeSession(paint: () => void): {
  live: SplitResizeLive
  begin: () => void
  move: (splitId: string, ratio: number) => void
  end: () => void
} {
  const live: SplitResizeLive = { active: false, ratio: null }
  let raf = 0
  const schedule = (): void => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      paint()
    })
  }
  return {
    live,
    begin: () => { live.active = true },
    move: (splitId, ratio) => {
      live.ratio = { id: splitId, ratio }
      schedule()
    },
    end: () => {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
      // Flush the final pointer position (or restored start ratio) before ending.
      // React may not write unchanged styles back after a cancelled DOM-only resize.
      if (live.active && live.ratio) paint()
      live.active = false
      live.ratio = null
    }
  }
}
