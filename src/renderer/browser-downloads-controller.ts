import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserDownload } from '../shared/types.js'
import { hasActiveDownload } from './browser-downloads-model.js'

// Owns the shelf's IPC subscription and its open/closed state, on the
// useBrowserExtensionLabController pattern.
//
// The one rule worth stating: a NEW download opens the shelf by itself. A file arriving from a
// page the user did not consciously download from is exactly the case where silence is wrong,
// and it is the case that used to be invisible entirely. Dismissing is sticky until the next
// new download, so the shelf never fights a user who closed it.

export type BrowserDownloadsController = {
  downloads: BrowserDownload[]
  isOpen: boolean
  hasActive: boolean
  toggle: () => void
  dismiss: () => void
  pause: (id: string) => void
  resume: (id: string) => void
  cancel: (id: string) => void
  reveal: (id: string) => void
  clear: () => void
}

export function useBrowserDownloadsController(): BrowserDownloadsController {
  const [downloads, setDownloads] = useState<BrowserDownload[]>([])
  const [isOpen, setIsOpen] = useState(false)
  // Ids already seen, so re-renders from progress ticks do not re-open a dismissed shelf.
  const seen = useRef(new Set<string>())

  const receive = useCallback((next: BrowserDownload[]) => {
    setDownloads(next)
    const fresh = next.filter((download) => !seen.current.has(download.id))
    next.forEach((download) => seen.current.add(download.id))
    if (fresh.length > 0) setIsOpen(true)
  }, [])

  useEffect(() => window.closedai.browserDownloads.onChanged(receive), [receive])
  useEffect(() => {
    let active = true
    void window.closedai.browserDownloads.list()
      .then((next) => {
        if (!active) return
        // A mount backfill is history, not news: record the ids without opening the shelf.
        next.forEach((download) => seen.current.add(download.id))
        setDownloads(next)
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  return useMemo(() => ({
    downloads,
    isOpen,
    hasActive: hasActiveDownload(downloads),
    toggle: () => setIsOpen((open) => !open),
    dismiss: () => setIsOpen(false),
    pause: (id: string) => { void window.closedai.browserDownloads.pause(id) },
    resume: (id: string) => { void window.closedai.browserDownloads.resume(id) },
    cancel: (id: string) => { void window.closedai.browserDownloads.cancel(id) },
    reveal: (id: string) => { void window.closedai.browserDownloads.reveal(id) },
    clear: () => { void window.closedai.browserDownloads.clear() }
  }), [downloads, isOpen])
}
