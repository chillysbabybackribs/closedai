import { useEffect, useMemo, type JSX, type RefObject } from 'react'
import { crossWindowDockCanvasSize, setCrossWindowDockCanvasSize, useCrossWindowDockHover } from '../app-windows/cross-window-dock-store.js'
import { JoinTabsPreview } from './floating/join-tabs-preview.js'
import { resolveCrossDockTarget } from './floating/cross-window-dock-target.js'
import { targetPreview } from './floating/window-targets.js'
import type { WindowFrame } from './floating/use-window-drag.js'
import { position } from './layout-geometry-dom.js'
export function CrossWindowDockPreview({ canvas, frame, browserVisible, title }: {
  canvas: RefObject<HTMLElement | null>
  frame: () => WindowFrame
  browserVisible: boolean
  title: (id: string) => string
}): JSX.Element | null {
  const hover = useCrossWindowDockHover()
  const snapshot = frame()
  useEffect(() => { setCrossWindowDockCanvasSize(snapshot.size) }, [snapshot.size.width, snapshot.size.height])
  const preview = useMemo(() => {
    if (!hover) return null
    const now = frame()
    const probe = hover.tabIds[0] ?? hover.sourcePaneId
    const target = resolveCrossDockTarget(probe, hover, now.size, now.tiled, now.floating)
    return { target, rect: targetPreview(now.tree, probe, target, now.size, browserVisible, now.tiled, now.floating) }
  }, [hover, frame, browserVisible, snapshot.tree, snapshot.size.width, snapshot.size.height])
  if (!hover || !preview) return null
  const join = preview.target.kind === 'group'
    ? { target: preview.target.target, incoming: hover.tabIds }
    : null
  const ghost = hover.tabIds[0] ? title(hover.tabIds[0]) : hover.ghostTabLabel
  const showSnap = preview.rect && preview.target.kind !== 'group' && preview.target.kind !== 'free'
  return <>
    {showSnap && <div className="chat-layout-snap-preview" data-kind={preview.target.kind}
      style={position(preview.rect!)} aria-hidden="true" />}
    <JoinTabsPreview canvas={canvas} title={() => ghost} join={join} />
  </>
}

export { crossWindowDockCanvasSize }
