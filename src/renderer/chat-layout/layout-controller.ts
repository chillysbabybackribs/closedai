import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import { dockPane, paneIds, readLayout, removePane, replacePane, resizeSplit, saveLayout, type DockEdge } from './layout-tree.js'

/** The component owning this hook is keyed by project directory. */
export function useChatLayout(snapshot: ChatWorkspaceSnapshot) {
  const cwd = snapshot.workspace?.cwd ?? snapshot.selected.cwd
  const [layout, setLayout] = useState(() => {
    const saved = readLayout(window.localStorage, cwd)
    let tree = saved.tree
    const available = new Set(snapshot.chats.map((chat) => chat.paneId))
    for (const id of paneIds(tree)) if (!available.has(id)) tree = removePane(tree, id)
    if (!tree) tree = { kind: 'pane' as const, id: snapshot.selectedPaneId }
    else if (!paneIds(tree).includes(snapshot.selectedPaneId)) {
      tree = replacePane(tree, paneIds(tree)[0]!, snapshot.selectedPaneId)
    }
    return { ...saved, tree }
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const selected = useRef(snapshot.selectedPaneId)
  const current = useRef(layout)
  current.current = layout
  const idsKey = JSON.stringify(paneIds(layout.tree))

  useEffect(() => {
    saveLayout(window.localStorage, cwd, layout)
  }, [cwd, layout])

  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[]
    if (!ids.length || !ids[0]) return
    let active = true
    void window.closedai.chat.setVisiblePanes(cwd, ids).catch((reason: unknown) => {
      if (active) setError(String(reason))
    })
    return () => { active = false }
  }, [cwd, idsKey])

  // A normal sidebar click focuses an existing tile, or replaces the focused tile.
  // Split/add operations manage their own destination while main announces selection.
  useEffect(() => {
    if (pending.current) return
    const next = snapshot.selectedPaneId
    const previous = selected.current
    selected.current = next
    setLayout((value) => {
      let tree = value.tree
      const available = new Set(snapshot.chats.map((chat) => chat.paneId))
      for (const id of paneIds(tree)) if (!available.has(id)) tree = removePane(tree, id)
      if (!tree) tree = { kind: 'pane', id: next }
      else if (!paneIds(tree).includes(next)) {
        tree = replacePane(tree, paneIds(tree).includes(previous) ? previous : paneIds(tree)[0]!, next)
      }
      return tree === value.tree ? value : { ...value, tree }
    })
  }, [snapshot.selectedPaneId, snapshot.chats])

  const dock = useCallback(async (id: string | null, target: string, edge: DockEdge): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (paneIds(current.current.tree).length >= 32 && (!id || !paneIds(current.current.tree).includes(id))) {
        throw new Error('The workspace already has 32 visible chats')
      }
      const added = id ? await window.closedai.chat.openChat(id) : await window.closedai.chat.newPeer()
      selected.current = added
      setLayout((value) => ({ ...value, tree: dockPane(value.tree, added, target, edge, crypto.randomUUID()) }))
    } catch (reason) { setError(String(reason)) }
    finally { pending.current = false; setBusy(false) }
  }, [])

  const hide = useCallback(async (id: string): Promise<void> => {
    const remaining = removePane(current.current.tree, id)
    if (!remaining || pending.current) return
    pending.current = true
    try {
      if (selected.current === id) {
        selected.current = paneIds(remaining)[0]!
        await window.closedai.chat.selectPane(selected.current)
      }
      setLayout((value) => ({ ...value, tree: remaining }))
    } catch (reason) { setError(String(reason)) }
    finally { pending.current = false }
  }, [])

  const resize = useCallback((id: string, ratio: number) => {
    setLayout((value) => ({ ...value, tree: resizeSplit(value.tree, id, ratio) }))
  }, [])
  const toggleBrowser = useCallback(() => setLayout((value) => ({ ...value, browserVisible: !value.browserVisible })), [])
  return { ...layout, error, busy, dock, hide, resize, toggleBrowser }
}
