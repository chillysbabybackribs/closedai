import { BROWSER_PANE_ID, layoutGeometry, removePane, type ChatLayout, type SplitRatioOverrides } from './layout-tree.js'
import { applyLayoutGeometryDom } from './layout-geometry-dom.js'

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
