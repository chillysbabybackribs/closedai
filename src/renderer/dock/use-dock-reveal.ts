import { useCallback, useEffect, useRef, useState } from 'react'
import { HIDE_DELAY_MS, pointerReveal } from './dock-model.js'

/**
 * Auto-hide, as macOS's hidden Dock: the dock rises when the pointer touches the window's bottom
 * edge and sinks a moment after the pointer leaves it. `held` (an open list, or keyboard focus in
 * the dock) keeps it up; `pinned` keeps it up for good.
 *
 * The bottom edge is the workspace's own padding, never a native browser view, so the renderer
 * always sees the pointer arrive there. While the dock is up it covers the browser, which then
 * shows a still (titlebar-browser-freeze.ts) and passes the pointer to the renderer too.
 */
export function useDockReveal({ pinned, held }: { pinned: boolean; held: boolean }): {
  shown: boolean
  show: () => void
  release: () => void
} {
  const [raised, setRaised] = useState(false)
  const timer = useRef(0)
  const raisedRef = useRef(false)
  const heldRef = useRef(held)
  heldRef.current = held
  // Whether the pointer was last seen at or near the dock; closing a list over it must not hide it.
  const near = useRef(false)

  const cancel = useCallback((): void => {
    window.clearTimeout(timer.current)
    timer.current = 0
  }, [])
  const show = useCallback((): void => {
    cancel()
    if (raisedRef.current) return
    raisedRef.current = true
    setRaised(true)
  }, [cancel])
  const release = useCallback((): void => {
    if (!raisedRef.current || heldRef.current || near.current || timer.current) return
    timer.current = window.setTimeout(() => {
      timer.current = 0
      if (heldRef.current) return
      raisedRef.current = false
      setRaised(false)
    }, HIDE_DELAY_MS)
  }, [])

  useEffect(() => {
    if (pinned) return
    const onMove = (event: PointerEvent): void => {
      const decision = pointerReveal(event.clientY, window.innerHeight, raisedRef.current)
      near.current = decision !== 'leave'
      if (decision === 'show') show()
      else if (decision === 'hold') cancel()
      else release()
    }
    // Leaving through the bottom edge keeps the dock, as reaching past a screen edge does.
    const onLeave = (): void => { release() }
    const onBlur = (): void => { near.current = false; release() }
    window.addEventListener('pointermove', onMove, { capture: true, passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onBlur)
    return () => {
      cancel()
      window.removeEventListener('pointermove', onMove, { capture: true })
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onBlur)
    }
  }, [pinned, show, cancel, release])

  // A list closing with the pointer elsewhere starts the hide delay.
  useEffect(() => { if (!held) release() }, [held, release])

  return { shown: pinned || raised, show, release }
}
