import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChatProvider, ProviderUsageSnapshot } from '../../shared/chat.js'
import { CHAT_PROVIDERS } from '../../shared/chat-providers.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { providerUsageEntries, type ProviderUsageEntry } from './provider-usage-model.js'

// Open, the flyout is being read: poll at main's one-minute cache. Closed, only the dock figure
// shows, and four minutes keeps a reading inside the five-minute staleness line (USAGE_STALE_MS)
// without starting a provider's control process every minute for a number nobody is looking at.
const OPEN_POLL_MS = 60_000
const IDLE_POLL_MS = 4 * 60_000

export type ProviderUsageState = {
  /** One per signed-in account; every provider is present even before it reports. */
  entries: ProviderUsageEntry[]
  now: number
  /** Providers with a read in flight. */
  reading: ReadonlySet<ChatProvider>
  /** Ask main for a fresh reading of one provider, or of all four. Force skips main's one-minute cache. */
  refresh: (provider?: ChatProvider, force?: boolean) => void
}

/** Account probes merged with the telemetry attached chats already carry; no model turns. */
export function useProviderUsage(chats: readonly ChatRowSummary[], open: boolean): ProviderUsageState {
  const [readings, setReadings] = useState<ProviderUsageSnapshot[]>([])
  const [reading, setReading] = useState<ReadonlySet<ChatProvider>>(() => new Set())
  const [now, setNow] = useState(Date.now)
  const read = useCallback(async (provider: ChatProvider, force = false): Promise<void> => {
    setReading((prior) => new Set(prior).add(provider))
    try {
      const result = await window.closedai.chat.readProviderUsage(provider, force)
      setReadings((prior) => [...prior.filter((item) => item.provider !== provider), result])
    } catch {
      // Main answers a failed probe with a dated "unavailable" reading; a failed IPC keeps the last one.
    } finally {
      setReading((prior) => {
        const next = new Set(prior)
        next.delete(provider)
        return next
      })
      setNow(Date.now())
    }
  }, [])
  const refresh = useCallback((provider?: ChatProvider, force = false): void => {
    for (const item of provider ? [provider] : CHAT_PROVIDERS) void read(item, force)
  }, [read])
  useEffect(() => {
    if (open) refresh()
    const poll = (): void => { if (!document.hidden) refresh() }
    const timer = window.setInterval(poll, open ? OPEN_POLL_MS : IDLE_POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [open, refresh])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const entries = useMemo(() => providerUsageEntries(chats, readings), [chats, readings])
  return { entries, now, reading, refresh }
}
