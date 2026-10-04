import { useLayoutEffect, useRef } from 'react'
import { elementVisible, responsePaintTracker } from './response-paint.js'

export function useResponsePaint(paneId: string | undefined, turnId: string | null, hasText: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!paneId || !turnId || !hasText) return
    if (document.visibilityState !== 'visible' || !elementVisible(ref.current)) {
      responsePaintTracker.take(paneId, turnId)
      return
    }
    let second: number | null = null
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const rendererMs = responsePaintTracker.take(paneId, turnId)
        if (rendererMs === null || document.visibilityState !== 'visible' || !elementVisible(ref.current)) return
        void window.closedai?.performance?.paint({ paneId, turnId, rendererMs }).catch(() => {})
      })
    })
    return () => { cancelAnimationFrame(first); if (second !== null) cancelAnimationFrame(second) }
  }, [paneId, turnId, hasText])
  return ref
}
