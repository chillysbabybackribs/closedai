import { useEffect, useRef, useState, type RefObject } from 'react'
import { HIDE_DELAY_MS, pointerReveal, type DockBounds } from './dock-model.js'

export function readDockControlBounds(root: HTMLElement | null): DockBounds | null {
  const cluster = root?.querySelector('[data-slot="dock-control-cluster"]')
  if (!(cluster instanceof HTMLElement)) return null
  const rect = cluster.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/** Pointer intent and menu/focus holds share one cancellable hide delay. */
export function createDockReveal(
  publish: (shown: boolean) => void,
  scheduleHide: (hide: () => void) => () => void = (hide) => {
    const timer = setTimeout(hide, HIDE_DELAY_MS)
    return () => clearTimeout(timer)
  }
) {
  let shown = false
  let held = false
  let pointer: { x: number; y: number; bounds: DockBounds | null } | null = null
  let cancelHide: (() => void) | null = null
  const cancel = (): void => { cancelHide?.(); cancelHide = null }
  const change = (next: boolean): void => {
    if (shown === next) return
    shown = next
    publish(next)
  }
  const keepOpen = (): boolean => held || (pointer !== null && pointerReveal(pointer.x, pointer.y, pointer.bounds, shown) !== 'leave')
  const sync = (): void => {
    if (keepOpen()) { cancel(); change(true) }
    else if (shown && !cancelHide) cancelHide = scheduleHide(() => {
      cancelHide = null
      if (!keepOpen()) change(false)
    })
  }
  return {
    pointer(x: number, y: number, bounds: DockBounds | null) { pointer = { x, y, bounds }; sync() },
    leave() { pointer = null; sync() },
    hold(next: boolean) { held = next; sync() },
    dispose: cancel
  }
}

/** Reveal only when the pointer is over the dock control cluster; no full-width hit band. */
export function useDockReveal(root: RefObject<HTMLDivElement | null>, heldOpen: boolean): boolean {
  const [shown, setShown] = useState(false)
  const controller = useRef<ReturnType<typeof createDockReveal> | null>(null)
  const panelsOpen = useRef(heldOpen)
  const keyboardFocus = useRef(false)
  panelsOpen.current = heldOpen

  useEffect(() => {
    const reveal = createDockReveal(setShown)
    controller.current = reveal
    let keyboard = true
    const syncHold = (): void => reveal.hold(panelsOpen.current || keyboardFocus.current)
    const inDock = (target: EventTarget | null): boolean => target instanceof Node && Boolean(root.current?.contains(target))
    const pointerMove = (event: PointerEvent): void => {
      reveal.pointer(event.clientX, event.clientY, readDockControlBounds(root.current))
    }
    const pointerDown = (event: PointerEvent): void => {
      keyboard = false
      keyboardFocus.current = false
      syncHold()
      pointerMove(event)
    }
    const focus = (event: FocusEvent): void => {
      keyboardFocus.current = keyboard && inDock(event.target)
      syncHold()
    }
    const blur = (event: FocusEvent): void => {
      keyboardFocus.current = keyboard && inDock(event.relatedTarget)
      syncHold()
    }
    const keyDown = (): void => {
      keyboard = true
      keyboardFocus.current = inDock(document.activeElement)
      syncHold()
    }
    const leaveWindow = (): void => {
      keyboardFocus.current = false
      reveal.leave()
      syncHold()
    }
    const pointerOut = (event: PointerEvent): void => { if (!event.relatedTarget) reveal.leave() }
    syncHold()
    window.addEventListener('pointermove', pointerMove, true)
    window.addEventListener('pointerdown', pointerDown, true)
    window.addEventListener('pointerout', pointerOut, true)
    window.addEventListener('focusin', focus, true)
    window.addEventListener('focusout', blur, true)
    window.addEventListener('keydown', keyDown, true)
    window.addEventListener('blur', leaveWindow)
    return () => {
      reveal.dispose()
      controller.current = null
      window.removeEventListener('pointermove', pointerMove, true)
      window.removeEventListener('pointerdown', pointerDown, true)
      window.removeEventListener('pointerout', pointerOut, true)
      window.removeEventListener('focusin', focus, true)
      window.removeEventListener('focusout', blur, true)
      window.removeEventListener('keydown', keyDown, true)
      window.removeEventListener('blur', leaveWindow)
    }
  }, [root])

  useEffect(() => {
    controller.current?.hold(heldOpen || keyboardFocus.current)
  }, [heldOpen])
  return shown
}
