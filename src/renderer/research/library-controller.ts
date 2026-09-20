import { useEffect, useRef, useState } from 'react'
import type { LibrarySettings, LibrarySnapshot } from '../../shared/research-library.js'

export function useResearchLibrary(open: boolean) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const [topics, setTopics] = useState('')
  const [days, setDays] = useState(90)
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const epoch = useRef(0)

  useEffect(() => {
    const current = ++epoch.current
    if (!open) return
    setSnapshot(null)
    setError('')
    setBusy(false)
    void window.closedai.researchLibrary.snapshot().then((next) => {
      if (current !== epoch.current) return
      setSnapshot(next)
      setTopics(next.settings.topics.join('\n'))
      setDays(next.settings.lookbackDays)
      setEnabled(next.settings.enabled)
    }).catch((failure) => {
      if (current === epoch.current) setError(String(failure.message ?? failure))
    })
    return () => { epoch.current++ }
  }, [open])

  // Refresh belongs to the app, so reopening the dialog reconnects to its progress.
  useEffect(() => {
    if (!open || !snapshot?.refreshing) return
    const current = epoch.current
    const timer = window.setTimeout(() => {
      void window.closedai.researchLibrary.progress().then(async (progress) => {
        if (current !== epoch.current) return
        if (progress.refreshing) setSnapshot((previous) => previous ? { ...previous, ...progress } : previous)
        else {
          const next = await window.closedai.researchLibrary.snapshot()
          if (current === epoch.current) setSnapshot(next)
        }
      }).catch((failure) => {
        if (current === epoch.current) setError(String(failure.message ?? failure))
      })
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [open, snapshot])

  const settings: LibrarySettings = {
    topics: topics.split('\n').map((topic) => topic.trim()).filter(Boolean), lookbackDays: days, enabled
  }
  const dirty = Boolean(snapshot && JSON.stringify(settings) !== JSON.stringify(snapshot.settings))
  const valid = settings.topics.length >= 1 && settings.topics.length <= 5 &&
    settings.topics.every((topic) => topic.length >= 3 && topic.length <= 200)

  async function act(operation: () => Promise<LibrarySnapshot>, syncSettings = false) {
    const current = epoch.current
    setBusy(true)
    setError('')
    try {
      const next = await operation()
      if (current === epoch.current) {
        setSnapshot(next)
        if (syncSettings) {
          setTopics(next.settings.topics.join('\n'))
          setDays(next.settings.lookbackDays)
          setEnabled(next.settings.enabled)
        }
      }
    } catch (failure) {
      if (current === epoch.current) setError(String((failure as Error).message ?? failure))
    } finally {
      if (current === epoch.current) setBusy(false)
    }
  }

  function refresh() {
    const current = epoch.current
    setSnapshot((current) => current ? { ...current, refreshing: true } : current)
    void act(async () => {
      try { return await window.closedai.researchLibrary.refresh() }
      finally {
        // The final snapshot also recovers from a persistence/network failure.
        const next = await window.closedai.researchLibrary.snapshot()
        if (current === epoch.current) setSnapshot(next)
      }
    })
  }

  return {
    snapshot, topics, setTopics, days, setDays, enabled, setEnabled, dirty, valid, busy, error,
    save: () => act(() => window.closedai.researchLibrary.configure(settings), true),
    refresh,
    cancel: () => { void window.closedai.researchLibrary.cancel().catch((failure) => setError(String(failure.message ?? failure))) },
    dismiss: (id: string) => act(() => window.closedai.researchLibrary.dismiss(id)),
    restore: () => act(() => window.closedai.researchLibrary.restore()),
    openPaper: (url: string) => { void window.closedai.browser.openTab(url).catch((failure) => setError(String(failure.message ?? failure))) }
  }
}
