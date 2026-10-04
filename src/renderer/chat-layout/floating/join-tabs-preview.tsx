import { Plus } from '../../icons/index.js'
import { useLayoutEffect, useState, type RefObject } from 'react'
import { layoutTileElement } from '../layout-geometry-dom.js'
import type { Rect } from '../layout-tree.js'
import type { JoinTabs } from './window-targets.js'

// Releasing on another window's tab strip joins its tabs. While that is the target, the window
// is ringed, its strip lights up, and a ghost tab stands where the incoming tab will land. It is
// drawn above the window in hand, which otherwise hides the strip it is hovering.

type Anchor = { window: Rect; strip: Rect; slot: number; room: number }

const GAP = 4
/** Room kept for the ghost tab at the end of a full strip. */
const GHOST_MIN = 120
const GHOST_MAX = 220

function measure(canvas: HTMLElement, target: string): Anchor | null {
  const tile = layoutTileElement(canvas, target)
  const strip = tile?.querySelector('.chat-layout-header')?.getBoundingClientRect()
  if (!tile || !strip) return null
  const origin = canvas.getBoundingClientRect()
  const box = tile.getBoundingClientRect()
  const tabs = tile.querySelector('.chat-layout-tabs')
  const list = tabs?.getBoundingClientRect()
  const last = tabs?.lastElementChild?.getBoundingClientRect()
  // A full or scrolled strip puts the ghost over the end of its visible tabs, clear of its buttons.
  const limit = (list?.right ?? strip.right) - GHOST_MIN - GAP
  const end = last && list ? Math.min(last.right, list.right) : strip.left
  const slot = Math.max(GAP, Math.min(end, limit) - strip.left + GAP)
  return {
    window: { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height },
    strip: { x: strip.left - box.left, y: strip.top - box.top, width: strip.width, height: strip.height },
    slot, room: (list?.right ?? strip.right) - strip.left - slot
  }
}

export function JoinTabsPreview({ canvas, join, title }: {
  canvas: RefObject<HTMLElement | null>
  join: JoinTabs | null
  title: (id: string) => string
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const target = join?.target ?? null
  useLayoutEffect(() => {
    setAnchor(target && canvas.current ? measure(canvas.current, target) : null)
  }, [canvas, target])
  if (!join || !anchor) return null
  const [first, ...rest] = join.incoming
  const label = rest.length ? `${title(first!)} + ${rest.length} more` : title(first!)
  const { window: box, strip, slot, room } = anchor
  return <div className="chat-join-preview" aria-hidden="true"
    style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
    <div className="chat-join-preview-strip" style={{ left: strip.x, top: strip.y, width: strip.width, height: strip.height }}>
      <span className="chat-join-preview-tab" style={{ left: slot, maxWidth: Math.min(GHOST_MAX, room) }}>
        <Plus size={12} aria-hidden="true" />
        <span>{label}</span>
      </span>
    </div>
  </div>
}
