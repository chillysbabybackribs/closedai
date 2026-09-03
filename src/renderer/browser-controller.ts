import {
  useEffect,
  useMemo,
  useState
} from 'react'
import { useNativeViewBounds } from './native-view-bounds.js'
import type { BrowserState, BrowserTabInfo } from '../shared/types.js'
import { useTitlebarBrowserFreeze } from './titlebar-browser-freeze.js'

import { useOmnibox } from './browser-omnibox.js'
type BrowserIdentity = { kind: 'web' | 'file' | 'other'; secure: boolean; host: string; rest: string }

export function useBrowserController(layoutKey?: string, visible = true, occluded = false) {
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const state = useBrowserSnapshot(isEditingUrl)
  const titlebarOverlay = useTitlebarBrowserFreeze()
  const omnibox = useOmnibox(state.browser, state.location, state.setLocation, setIsEditingUrl)
  const browserHostRef = useBrowserBounds(
    layoutKey,
    visible && !state.browser.navigationError,
    occluded || titlebarOverlay.open,
    titlebarOverlay.finishRestore
  )
  const displayedUrl = state.browser.navigationError?.url ?? state.browser.url
  const identity = useMemo(
    () => (isEditingUrl ? null : omniboxIdentity(displayedUrl)),
    [displayedUrl, isEditingUrl]
  )
  // Memoized so BrowserPane can be memoized. The pane is deliberately kept mounted while
  // hidden (its native-view host ref and ResizeObserver must survive a mode switch), and
  // its parent re-renders once per animation frame for the whole of a streaming turn — so
  // a fresh object literal here meant the entire browser chrome reconciled at token
  // frequency behind a zero-width column. This identity now changes when the browser
  // actually changes, not when a chat elsewhere receives a token.
  return useMemo(
    () => ({ ...state, ...omnibox, browserHostRef, identity, titlebarFreeze: titlebarOverlay.shot }),
    [state, omnibox, browserHostRef, identity, titlebarOverlay.shot]
  )
}

export type BrowserController = ReturnType<typeof useBrowserController>

function useBrowserSnapshot(isEditingUrl: boolean) {
  const [browser, setBrowser] = useState<BrowserState>({
    url: 'about:blank',
    title: 'New Tab',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    navigationError: null
  })
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [location, setLocation] = useState('https://www.google.com')

  useEffect(() => window.closedai.browser.onState((next) => {
    setBrowser(next)
    if (!isEditingUrl) setLocation(next.navigationError?.url ?? next.url)
  }), [isEditingUrl])

  useEffect(() => window.closedai.browser.onTabs(setTabs), [])

  useEffect(() => {
    let active = true
    void window.closedai.browser.snapshot().then((snapshot) => {
      if (!active || !snapshot) return
      setTabs(snapshot.tabs)
      setBrowser(snapshot.state)
      setLocation((current) => (isEditingUrl ? current : snapshot.state.navigationError?.url ?? snapshot.state.url))
    })
    return () => { active = false }
    // This mount-only snapshot fills events emitted before the renderer subscribed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return useMemo(() => ({ browser, tabs, location, setLocation }), [browser, tabs, location])
}

// See native-view-bounds.ts for why the layout key, coalesce, and settle re-measure are needed.
function useBrowserBounds(
  layoutKey?: string,
  visible = true,
  occluded = false,
  finishRestore?: () => void
) {
  return useNativeViewBounds(async (bounds) => {
    await window.closedai.browser.setBounds(bounds)
    if (!bounds.occluded) finishRestore?.()
  }, layoutKey, visible, occluded)
}

function omniboxIdentity(rawUrl: string): BrowserIdentity | null {
  if (!rawUrl || rawUrl === 'about:blank') return null
  let url: URL
  try { url = new URL(rawUrl) } catch { return null }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    // url.host (not hostname) keeps a non-default port visible — 127.0.0.1:5180
    // vs :5190 are different dev builds, and hiding the port made them
    // indistinguishable in the chrome (finding #430).
    const host = url.host.replace(/^www\./, '')
    const rest = (url.pathname === '/' ? '' : url.pathname) + url.search + url.hash
    return { kind: 'web', secure: url.protocol === 'https:', host, rest }
  }
  if (url.protocol === 'file:') return { kind: 'file', secure: false, host: 'Local file', rest: url.pathname }
  return { kind: 'other', secure: false, host: rawUrl, rest: '' }
}
