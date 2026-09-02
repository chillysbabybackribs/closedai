import { useEffect, useState } from 'react'

const AGING_TICK_MS = 30_000

export function useDrawerAgingClock(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const refresh = (): void => setNow(Date.now())
    const interval = window.setInterval(refresh, AGING_TICK_MS)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return now
}
