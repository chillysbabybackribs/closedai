import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import { dockPane, paneIds, readLayout, removePane, resizeSplit, saveLayout, type ChatLayout, type DockEdge } from './layout-tree.js'
import { addTab, moveTab, pruneTabs, removeTab, selectTab, tabIds, tabOwner } from './layout-tabs.js'

/** The component owning this hook is keyed by project directory. */
export function useChatLayout(snapshot: ChatWorkspaceSnapshot) {
  const cwd = snapshot.workspace?.cwd ?? snapshot.selected.cwd
  const [layout, setLayout] = useState(() => {
    const saved = readLayout(window.localStorage, cwd)
    let tree = saved.tree
    const available = new Set(snapshot.chats.filter((chat) => chat.cwd === cwd).map((chat) => chat.paneId))
    tree = pruneTabs(tree, available)
    if (!tree) tree = { kind: 'pane' as const, id: snapshot.selectedPaneId }
    else if (!paneIds(tree).includes(snapshot.selectedPaneId)) {
      tree = selectTab(tree, paneIds(tree)[0]!, snapshot.selectedPaneId)
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
  const tabsKey = JSON.stringify(tabIds(layout.tree))

  useEffect(() => {
    saveLayout(window.localStorage, cwd, layout)
  }, [cwd, layout])

  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[]
    if (!ids.length || !ids[0]) return
    let active = true
    void window.closedai.chat.setVisiblePanes(cwd, ids, JSON.parse(tabsKey) as string[]).catch((reason: unknown) => {
      if (active) setError(String(reason))
    })
    return () => { active = false }
  }, [cwd, idsKey, tabsKey])

  // A normal sidebar click focuses an existing tile, or replaces the focused tile.
  // Split/add operations manage their own destination while main announces selection.
  useEffect(() => {
    if (pending.current) return
    const next = snapshot.selectedPaneId
    const previous = selected.current
    selected.current = next
    setLayout((value) => {
      let tree: ChatLayout | null = value.tree
      const available = new Set(snapshot.chats.filter((chat) => chat.cwd === cwd).map((chat) => chat.paneId))
      tree = pruneTabs(tree, available)
      if (!tree) tree = { kind: 'pane', id: next }
      else if (!paneIds(tree).includes(next)) {
        tree = selectTab(tree, paneIds(tree).includes(previous) ? previous : paneIds(tree)[0]!, next)
      }
      return tree === value.tree ? value : { ...value, tree }
    })
  }, [snapshot.selectedPaneId, snapshot.chats, busy, cwd])

  // A null edge adds a tab in the target tile without adding a split.
  const dock = useCallback(async (id: string | null, target: string, edge: DockEdge | null, singleTab = false): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (id && snapshot.chats.find((chat) => chat.paneId === id)?.cwd !== cwd) {
        throw new Error('Open this chat’s directory before splitting it into the layout')
      }
      const treeBefore = current.current.tree
      const sourceOwner = id ? tabOwner(treeBefore, id) : null
      const sourceHasSiblings = sourceOwner && tabIds(treeBefore).some((tab) => tab !== id && tabOwner(treeBefore, tab) === sourceOwner)
      if (edge && paneIds(treeBefore).length >= 32 && (!id || !paneIds(treeBefore).includes(id) || (singleTab && sourceHasSiblings))) {
        throw new Error('The workspace already has 32 visible chats')
      }
      if (!id) await window.closedai.chat.selectPane(target)
      const added = id ? await window.closedai.chat.openChat(id) : await window.closedai.chat.newPeer()
      selected.current = added
      setLayout((value) => {
        if (singleTab || (id && !edge)) return { ...value,
          tree: moveTab(value.tree, added, target, edge, crypto.randomUUID()) }
        // Dragging a hidden sidebar tab out leaves its sibling tabs in their tile.
        const tree = edge && tabOwner(value.tree, added) && !paneIds(value.tree).includes(added)
          ? removeTab(value.tree, added)! : value.tree
        return { ...value, tree: edge
          ? dockPane(tree, added, target, edge, crypto.randomUUID())
          : addTab(tree, target, added) }
      })
    } catch (reason) { setError(String(reason)) }
    finally { pending.current = false; setBusy(false) }
  }, [snapshot.chats, cwd])

  const newChat = useCallback((target: string) => dock(null, target, null), [dock])

  const activateTab = useCallback(async (id: string): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await window.closedai.chat.openChat(id)
      selected.current = id
      setLayout((value) => ({ ...value, tree: selectTab(value.tree, paneIds(value.tree)[0]!, id) }))
    } catch (reason) { setError(String(reason)) }
    finally { pending.current = false; setBusy(false) }
  }, [])

  const closeTab = useCallback(async (id: string): Promise<void> => {
    const tree = current.current.tree
    const remaining = removeTab(tree, id)
    if (!remaining || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const owner = tabOwner(tree, id)
      if (owner === id) {
        const sibling = tabIds(tree).find((tab) => tab !== id && tabOwner(tree, tab) === owner)
        const next = sibling ? tabOwner(remaining, sibling)! : paneIds(remaining)[0]!
        // Open also reattaches a tab that was parked and trimmed in the background.
        await window.closedai.chat.openChat(next)
        selected.current = next
      }
      setLayout((value) => ({ ...value, tree: remaining }))
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
  return { ...layout, error, busy, dock, newChat, activateTab, closeTab, hide, resize, toggleBrowser }
}
