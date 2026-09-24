import { useEffect, useRef, useState } from 'react'
import { DIVIDER_SIZE, type layoutGeometry } from './layout-tree.js'

type Divider = ReturnType<typeof layoutGeometry>['dividers'][number]

export function LayoutDivider({ divider, onResize }: {
  divider: Divider
  onResize: (id: string, ratio: number) => void
}) {
  const [active, setActive] = useState(false)
  const release = useRef<(() => void) | null>(null)
  const resize = useRef(onResize)
  resize.current = onResize
  useEffect(() => () => release.current?.(), [])
  const horizontal = divider.axis === 'horizontal'
  const clamp = (ratio: number): number => Math.max(divider.min, Math.min(divider.max, ratio))

  return <div className="chat-layout-divider" data-axis={divider.axis} data-resizing={active}
    style={{ left: divider.rect.x, top: divider.rect.y, width: divider.rect.width, height: divider.rect.height }}
    role="separator" tabIndex={0} data-ui="layout.divider" data-ui-key={divider.id}
    aria-label="Resize adjacent panes" aria-orientation={horizontal ? 'vertical' : 'horizontal'}
    aria-valuenow={Math.round(divider.ratio * 100)} aria-valuemin={Math.round(divider.min * 100)} aria-valuemax={Math.round(divider.max * 100)}
    title="Drag to resize · Double-click to balance · Arrow keys to adjust (Shift for fine control)"
    onDoubleClick={() => onResize(divider.id, clamp(0.5))}
    onKeyDown={(event) => {
      const keys = horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
      if (!keys.includes(event.key)) return
      event.preventDefault()
      onResize(divider.id, clamp(divider.ratio + (event.key === keys[0] ? -1 : 1) * (event.shiftKey ? 0.01 : 0.05)))
    }}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary || release.current) return
      event.preventDefault()
      const target = event.currentTarget
      const pointerId = event.pointerId
      const start = horizontal ? event.clientX : event.clientY
      const length = (horizontal ? divider.parent.width : divider.parent.height) - DIVIDER_SIZE
      target.setPointerCapture(pointerId)
      target.focus({ preventScroll: true })
      setActive(true)
      const body = target.ownerDocument.body
      const previous = body.getAttribute('data-layout-resize')
      body.setAttribute('data-layout-resize', divider.axis)
      let moveRaf = 0
      let lastMove: PointerEvent | null = null
      const applyMove = (): void => {
        moveRaf = 0
        const next = lastMove
        if (!next) return
        const delta = (horizontal ? next.clientX : next.clientY) - start
        resize.current(divider.id, clamp(divider.ratio + delta / length))
      }
      const move = (next: PointerEvent): void => {
        if (next.pointerId !== pointerId) return
        lastMove = next
        if (!moveRaf) moveRaf = requestAnimationFrame(applyMove)
      }
      const finish = (): void => {
        if (moveRaf) {
          cancelAnimationFrame(moveRaf)
          moveRaf = 0
          applyMove()
        }
        release.current = null
        window.removeEventListener('pointermove', move, true)
        window.removeEventListener('pointerup', up, true)
        window.removeEventListener('pointercancel', cancel, true)
        window.removeEventListener('blur', finish)
        window.removeEventListener('keydown', key, true)
        target.removeEventListener('lostpointercapture', cancel)
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
        if (previous === null) body.removeAttribute('data-layout-resize')
        else body.setAttribute('data-layout-resize', previous)
        setActive(false)
      }
      const up = (next: PointerEvent): void => {
        if (next.pointerId !== pointerId) return
        move(next)
        finish()
      }
      const cancel = (next: PointerEvent): void => { if (next.pointerId === pointerId) finish() }
      const key = (next: KeyboardEvent): void => {
        if (next.key !== 'Escape') return
        next.preventDefault()
        next.stopPropagation()
        resize.current(divider.id, divider.ratio)
        finish()
      }
      release.current = finish
      window.addEventListener('pointermove', move, true)
      window.addEventListener('pointerup', up, true)
      window.addEventListener('pointercancel', cancel, true)
      window.addEventListener('blur', finish)
      window.addEventListener('keydown', key, true)
      target.addEventListener('lostpointercapture', cancel)
    }}
  />
}
