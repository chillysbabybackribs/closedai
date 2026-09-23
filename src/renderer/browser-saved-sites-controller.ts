import { useCallback, useEffect, useMemo, useState } from 'react'
import { savedSiteKey, type SavedSite } from '../shared/saved-sites.js'

// Owns the saved-sites IPC subscription and the panel's open state, on the
// useBrowserDownloadsController pattern. Unlike downloads, nothing opens this panel by itself:
// saving is always a user act, so the panel only appears when the star or the tab menu asks.

export type SaveableTab = { url: string; title: string; favicon: string | null }

export type BrowserSavedSitesController = {
  sites: SavedSite[]
  isOpen: boolean
  /** Row whose note field should take focus, set right after a save from the star. */
  focusId: string | null
  savedFor: (url: string) => SavedSite | null
  /** Star: save the page and show it, or just show the panel when the page is already saved. */
  star: (tab: SaveableTab) => Promise<void>
  /** Tab menu: save when unsaved, remove when saved. */
  toggleSave: (tab: SaveableTab) => Promise<void>
  dismiss: () => void
  update: (id: string, note: string) => Promise<void>
  remove: (id: string) => Promise<void>
  open: (url: string) => Promise<void>
}

export function useBrowserSavedSitesController(): BrowserSavedSitesController {
  const [sites, setSites] = useState<SavedSite[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)

  useEffect(() => window.closedai.savedSites.onChanged(setSites), [])
  useEffect(() => {
    let active = true
    void window.closedai.savedSites.list().then((next) => { if (active) setSites(next) }).catch(() => {})
    return () => { active = false }
  }, [])

  const savedFor = useCallback((url: string): SavedSite | null => {
    const key = savedSiteKey(url)
    return key ? sites.find((site) => savedSiteKey(site.url) === key) ?? null : null
  }, [sites])

  const star = useCallback(async (tab: SaveableTab): Promise<void> => {
    if (isOpen) {
      setIsOpen(false)
      return
    }
    if (!savedFor(tab.url)) {
      const site = await window.closedai.savedSites.save({ url: tab.url, title: tab.title, favicon: tab.favicon })
      setFocusId(site.id)
    } else setFocusId(null)
    setIsOpen(true)
  }, [isOpen, savedFor])

  const toggleSave = useCallback(async (tab: SaveableTab): Promise<void> => {
    const existing = savedFor(tab.url)
    if (existing) await window.closedai.savedSites.remove(existing.id)
    else {
      const site = await window.closedai.savedSites.save({ url: tab.url, title: tab.title, favicon: tab.favicon })
      setFocusId(site.id)
      setIsOpen(true)
    }
  }, [savedFor])

  return useMemo(() => ({
    sites,
    isOpen,
    focusId,
    savedFor,
    star,
    toggleSave,
    dismiss: () => setIsOpen(false),
    update: async (id: string, note: string) => { await window.closedai.savedSites.update(id, { note }) },
    remove: async (id: string) => { await window.closedai.savedSites.remove(id) },
    open: (url: string) => window.closedai.browser.navigate(url)
  }), [sites, isOpen, focusId, savedFor, star, toggleSave])
}
