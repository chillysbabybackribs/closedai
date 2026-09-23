import { useCallback, useEffect, useMemo, useState } from 'react'
import { savedSiteKey, type SavedSite } from '../shared/saved-sites.js'

// Shared by the title bar and browser controls so the collection stays reachable when the
// browser pane is hidden. Nothing opens it on its own; saving is a user act.

export type SaveableTab = { url: string; title: string; favicon: string | null }

export type BrowserSavedSitesController = {
  sites: SavedSite[]
  isOpen: boolean
  savedFor: (url: string) => SavedSite | null
  /** Star: save the page and show it, or just show the panel when the page is already saved. */
  star: (tab: SaveableTab) => Promise<void>
  /** Tab menu: save when unsaved, remove when saved. */
  toggleSave: (tab: SaveableTab) => Promise<void>
  dismiss: () => void
  toggle: () => void
  update: (id: string, note: string) => Promise<void>
  remove: (id: string) => Promise<void>
  open: (url: string) => Promise<void>
}

export function useBrowserSavedSitesController(): BrowserSavedSitesController {
  const [sites, setSites] = useState<SavedSite[]>([])
  const [isOpen, setIsOpen] = useState(false)

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
    if (!savedFor(tab.url)) {
      await window.closedai.savedSites.save({ url: tab.url, title: tab.title, favicon: tab.favicon })
      setIsOpen(true)
    } else setIsOpen((open) => !open)
  }, [savedFor])

  const toggleSave = useCallback(async (tab: SaveableTab): Promise<void> => {
    const existing = savedFor(tab.url)
    if (existing) await window.closedai.savedSites.remove(existing.id)
    else {
      await window.closedai.savedSites.save({ url: tab.url, title: tab.title, favicon: tab.favicon })
      setIsOpen(true)
    }
  }, [savedFor])

  return useMemo(() => ({
    sites,
    isOpen,
    savedFor,
    star,
    toggleSave,
    dismiss: () => setIsOpen(false),
    toggle: () => setIsOpen((open) => !open),
    update: async (id: string, note: string) => { await window.closedai.savedSites.update(id, { note }) },
    remove: async (id: string) => { await window.closedai.savedSites.remove(id) },
    open: (url: string) => window.closedai.browser.navigate(url)
  }), [sites, isOpen, savedFor, star, toggleSave])
}
