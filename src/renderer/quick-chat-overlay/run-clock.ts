import { useEffect, useState } from 'react'

// How long the quick chat's task has run, so a quiet stretch (a long think, a slow page) still shows
// the task is alive. Start times are kept per chat for the layer's life, so hiding and reopening the
// card, or the button taking its place, keeps counting from the same start.

const startedAt = new Map<string, number>()

/** Seconds the chat's task has run, ticking once a second; null while it is not running. */
export function useRunSeconds(paneId: string | null, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!paneId) return
    if (!running) {
      startedAt.delete(paneId)
      return
    }
    if (!startedAt.has(paneId)) startedAt.set(paneId, Date.now())
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [paneId, running])
  const start = paneId && running ? startedAt.get(paneId) : undefined
  return start === undefined ? (running ? 0 : null) : Math.max(0, Math.floor((now - start) / 1000))
}

/** "0:07", "1:42", "12:05". */
export function formatRunSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
