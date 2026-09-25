import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * The maximized window, which fills the canvas while every other window hides. It is view state,
 * not layout: it resets when the browser is revealed, when the window goes away or there is
 * nothing left to hide, and on Escape outside a text field.
 */
export function useMaximizedWindow(windows: ReadonlyArray<{ id: string; tabs: string[] }>, canHideOthers: boolean,
  browserRevealVersion: number | undefined): [string | null, Dispatch<SetStateAction<string | null>>] {
  const [maximized, setMaximized] = useState<string | null>(null)
  useEffect(() => { setMaximized(null) }, [browserRevealVersion])
  const present = maximized ? windows.some((tile) => tile.id === maximized || tile.tabs.includes(maximized)) : false
  useEffect(() => {
    if (maximized && (!present || !canHideOthers)) setMaximized(null)
  }, [maximized, present, canHideOthers])
  useEffect(() => {
    if (!maximized) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      setMaximized(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [maximized])
  return [maximized, setMaximized]
}
