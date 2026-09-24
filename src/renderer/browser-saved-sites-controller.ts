import { useCallback, useEffect, useMemo, useState } from 'react'
import { savedSiteKey, type SavedSite } from '../shared/saved-sites.js'

// Shared by the browser star and tab menu. The list lives in Developer → Saved sites (a view tab).

export type SaveableTab = { url: string; title: string; favicon: string | null }

export type BrowserSavedSitesController = {
  savedFor: (url: string) => SavedSite | null
  /** Star and tab menu: save when unsaved, remove when saved. */
  toggleSave: (tab: SaveableTab) => Promise<void>
  update: (id: string, note: string) => Promise<void>
  remove: (id: string) => Promise<void>
  open: (url: string) => Promise<void>
}

/** Live saved-site rows; `active` gates the initial list fetch when the view tab is hidden. */
export function useSavedSitesList(active = true): SavedSite[] {
  const [sites, setSites] = useState<SavedSite[]>([])
  useEffect(() => window.closedai.savedSites.onChanged(setSites), [])
  useEffect(() => {
    if (!active) return
    let live = true
    void window.closedai.savedSites.list().then((next) => { if (live) setSites(next) }).catch(() => {})
    return () => { live = false }
  }, [active])
  return sites
}

export function useBrowserSavedSitesController(): BrowserSavedSitesController {
  const sites = useSavedSitesList(true)

  const savedFor = useCallback((url: string): SavedSite | null => {
    const key = savedSiteKey(url)
    return key ? sites.find((site) => savedSiteKey(site.url) === key) ?? null : null
  }, [sites])

  const toggleSave = useCallback(async (tab: SaveableTab): Promise<void> => {
    const existing = savedFor(tab.url)
    if (existing) await window.closedai.savedSites.remove(existing.id)
    else await window.closedai.savedSites.save({ url: tab.url, title: tab.title, favicon: tab.favicon })
  }, [savedFor])

  return useMemo(() => ({
    savedFor,
    toggleSave,
    update: async (id: string, note: string) => { await window.closedai.savedSites.update(id, { note }) },
    remove: async (id: string) => { await window.closedai.savedSites.remove(id) },
    open: (url: string) => window.closedai.browser.navigate(url)
  }), [savedFor, toggleSave])
}
