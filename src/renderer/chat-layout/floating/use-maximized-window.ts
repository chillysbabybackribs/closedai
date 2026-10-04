import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

/**
 * The maximized window, which fills the canvas while every other window hides. The layout owns
 * the value and saves it, so a relaunch reopens the window maximized; this hook clears it when
 * the browser is revealed, when the window goes away, and on
 * Escape outside a text field.
 */
export function useMaximizedWindow(windows: ReadonlyArray<{ id: string; tabs: string[] }>,
  browserRevealVersion: number | undefined,
  [maximized, setMaximized]: [string | null, Dispatch<SetStateAction<string | null>>]): [string | null, Dispatch<SetStateAction<string | null>>] {
  // A reveal after mount clears it; the version the canvas mounts with is not a reveal.
  const revealed = useRef(browserRevealVersion)
  useEffect(() => {
    if (revealed.current === browserRevealVersion) return
    revealed.current = browserRevealVersion
    setMaximized(null)
  }, [browserRevealVersion, setMaximized])
  const present = maximized ? windows.some((tile) => tile.id === maximized || tile.tabs.includes(maximized)) : false
  useEffect(() => {
    // Before the canvas has measured there are no windows yet; that is not the window going away.
    if (maximized && windows.length && !present) setMaximized(null)
  }, [maximized, present, windows.length, setMaximized])
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
  }, [maximized, setMaximized])
  return [maximized, setMaximized]
}
