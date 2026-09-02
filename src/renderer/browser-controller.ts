import {
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useNativeViewBounds } from './native-view-bounds.js'
import type { BrowserState, BrowserTabInfo } from '../shared/types.js'
import { useTitlebarBrowserFreeze } from './titlebar-browser-freeze.js'

type GhostSuggestion = { base: string; remainder: string; url: string }
type BrowserIdentity = { kind: 'web' | 'file' | 'other'; secure: boolean; host: string; rest: string }

export function useBrowserController(layoutKey?: string, visible = true) {
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const state = useBrowserSnapshot(isEditingUrl)
  const titlebarOverlay = useTitlebarBrowserFreeze()
  const omnibox = useOmnibox(state.browser, state.location, state.setLocation, setIsEditingUrl)
  const browserHostRef = useBrowserBounds(
    layoutKey,
    visible && !state.browser.navigationError,
    titlebarOverlay.open,
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

function useOmnibox(
  browser: BrowserState,
  location: string,
  setLocation: (value: string) => void,
  setIsEditingUrl: (value: boolean) => void
) {
  const [ghost, setGhost] = useState<GhostSuggestion | null>(null)
  const omniboxRef = useRef<HTMLInputElement | null>(null)
  const lastTypedRef = useRef('')

  const navigate = useCallback(async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const target = ghost && ghost.base === location ? ghost.url : location
    setGhost(null)
    setIsEditingUrl(false)
    omniboxRef.current?.blur()
    await window.closedai.browser.navigate(target).catch(() => {})
  }, [ghost, location, setIsEditingUrl])

  const change = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.target
    const value = input.value
    const previous = lastTypedRef.current
    lastTypedRef.current = value
    const caretAtEnd = input.selectionStart === value.length && input.selectionEnd === value.length
    setLocation(value)
    setGhost(null)
    if (!value || !caretAtEnd || value.length <= previous.length) return
    const suggestion = await window.closedai.browser.suggest(value).catch(() => null)
    if (!suggestion || lastTypedRef.current !== value) return
    if (!suggestion.completion.toLowerCase().startsWith(value.toLowerCase())) return
    if (suggestion.completion.length === value.length) return
    setGhost({ base: value, remainder: suggestion.completion.slice(value.length), url: suggestion.url })
  }, [setLocation])

  const keyDown = useCallback((event: KeyboardEvent<HTMLInputElement>): void => {
    if (!ghost || ghost.base !== location) return
    const input = event.currentTarget
    const caretAtEnd = input.selectionStart === location.length && input.selectionEnd === location.length
    const accept = event.key === 'Tab' || ((event.key === 'ArrowRight' || event.key === 'End') && caretAtEnd)
    if (accept) {
      event.preventDefault()
      const completed = ghost.base + ghost.remainder
      lastTypedRef.current = completed
      setLocation(completed)
      setGhost(null)
      requestAnimationFrame(() => omniboxRef.current?.setSelectionRange(completed.length, completed.length))
    } else if (event.key === 'Backspace' || event.key === 'Delete') setGhost(null)
  }, [ghost, location, setLocation])

  const focus = useCallback((event: FocusEvent<HTMLInputElement>): void => {
    setIsEditingUrl(true)
    lastTypedRef.current = ''
    setGhost(null)
    const stripped = location.replace(/^https?:\/\//, '')
    if (stripped !== location) setLocation(stripped)
    event.currentTarget.select()
  }, [location, setLocation, setIsEditingUrl])

  const blur = useCallback((): void => {
    setGhost(null)
    lastTypedRef.current = ''
    setIsEditingUrl(false)
    setLocation(browser.navigationError?.url ?? browser.url)
  }, [browser.navigationError?.url, browser.url, setLocation, setIsEditingUrl])

  return useMemo(
    () => ({ ghost, omniboxRef, navigate, handleOmniboxChange: change, handleOmniboxKeyDown: keyDown, focus, blur }),
    [ghost, navigate, change, keyDown, focus, blur]
  )
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
