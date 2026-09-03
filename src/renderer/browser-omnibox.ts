import { type ChangeEvent, type FocusEvent, type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserState } from '../shared/types.js'
import type { BrowserHistoryMatch } from '../shared/browser-history.js'

type GhostSuggestion = { base: string; remainder: string; url: string }

export function useOmnibox(
  browser: BrowserState,
  location: string,
  setLocation: (value: string) => void,
  setIsEditingUrl: (value: boolean) => void
) {
  const [ghost, setGhost] = useState<GhostSuggestion | null>(null)
  const omniboxRef = useRef<HTMLInputElement | null>(null)
  const lastTypedRef = useRef('')
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [matches, setMatches] = useState<BrowserHistoryMatch[]>([])
  const [selected, setSelected] = useState(-1)
  const [revision, setRevision] = useState(0)
  const request = useRef(0)
  useEffect(() => {
    const id = ++request.current
    setMatches([])
    setSelected(-1)
    if (!suggestionsOpen) return
    void window.closedai.browser.searchHistory(location).then((rows) => {
      if (request.current === id) setMatches(rows)
    }).catch(() => {})
    return () => { request.current++ }
  }, [location, suggestionsOpen, revision])

  const suggestions = useMemo(() => {
    const rows = matches.map((match) => ({ ...match, kind: 'history' as const }))
    const query = location.trim()
    return query ? [...rows, {
      url: 'https://www.google.com/search?q=' + encodeURIComponent(query),
      title: query, completion: 'Search the web', kind: 'search' as const
    }] : rows
  }, [matches, location])

  useEffect(() => {
    if (suggestionsOpen && selected >= 0) {
      document.getElementById(`browser-suggestion-${selected}`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected, suggestionsOpen])

  const choose = useCallback((url: string): void => {
    setSuggestionsOpen(false)
    setGhost(null)
    lastTypedRef.current = ''
    setIsEditingUrl(false)
    omniboxRef.current?.blur()
    void window.closedai.browser.navigate(url).catch(() => {})
  }, [setIsEditingUrl])

  const removeHistory = useCallback(async (url: string): Promise<void> => {
    await window.closedai.browser.removeHistory(url)
    setGhost(null)
    setRevision((value) => value + 1)
  }, [])

  const navigate = useCallback(async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const target = suggestionsOpen && selected >= 0 && suggestions[selected] ? suggestions[selected].url : ghost && ghost.base === location ? ghost.url : location
    choose(target)
  }, [ghost, location, suggestionsOpen, selected, suggestions, choose])

  const change = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.target
    const value = input.value
    const previous = lastTypedRef.current
    lastTypedRef.current = value
    const caretAtEnd = input.selectionStart === value.length && input.selectionEnd === value.length
    setSuggestionsOpen(true)
    setSelected(-1)
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
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      setSuggestionsOpen(false)
      setGhost(null)
      lastTypedRef.current = ''
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setSuggestionsOpen(true)
      setGhost(null)
      setSelected((current) => suggestions.length
        ? (current < 0 ? (event.key === 'ArrowDown' ? 0 : suggestions.length - 1)
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length) : -1)
      return
    }
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
  }, [ghost, location, setLocation, suggestions.length])

  const focus = useCallback((event: FocusEvent<HTMLInputElement>): void => {
    setSuggestionsOpen(true)
    setIsEditingUrl(true)
    lastTypedRef.current = ''
    setGhost(null)
    const stripped = location.replace(/^https?:\/\//, '')
    if (stripped !== location) setLocation(stripped)
    event.currentTarget.select()
  }, [location, setLocation, setIsEditingUrl])

  const blur = useCallback((): void => {
    setSuggestionsOpen(false)
    setGhost(null)
    lastTypedRef.current = ''
    setIsEditingUrl(false)
    setLocation(browser.navigationError?.url ?? browser.url)
  }, [browser.navigationError?.url, browser.url, setLocation, setIsEditingUrl])

  return useMemo(
    () => ({ suggestions, suggestionsOpen, selected, choose, removeHistory, ghost, omniboxRef, navigate, handleOmniboxChange: change, handleOmniboxKeyDown: keyDown, focus, blur }),
    [suggestions, suggestionsOpen, selected, choose, removeHistory, ghost, navigate, change, keyDown, focus, blur]
  )
}

