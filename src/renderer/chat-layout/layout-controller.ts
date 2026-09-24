import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import { errorMessage } from '../error-message.js'
import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, chatPaneIds, isViewTabId, withBrowser, dockBrowser, dockPane, paneIds, readLayout, removePane, resizeSplit, saveLayout, type ChatLayout, type DockEdge } from './layout-tree.js'
import { addTab, chatTabIds, focusedCloseAction, isChatTabActive, moveTab, neighborTile, pruneTabs, removeTab, selectTab, tabIds, tabOwner, type TileDirection } from './layout-tabs.js'
import { pinOnMove, pruneViewScopes, tileView, viewScope, viewTabId, type ViewKind } from './layout-views.js'
import { removalNotice } from './layout-copy.js'
import { assignGroups, presetLayout, presetSlots, singleGroup, type CanvasSize, type LayoutPreset } from './layout-presets.js'
const ERROR_TTL_MS = 8000
/** Main announces a selection within one workspace event; past this the layout resyncs instead of staying locked. */
const CONFIRM_TIMEOUT_MS = 5000

/** The component owning this hook is keyed by project directory. */
export function useChatLayout(snapshot: ChatWorkspaceSnapshot) {
  const cwd = snapshot.workspace?.cwd ?? snapshot.selected.cwd
  const [layout, setLayout] = useState(() => {
    const saved = readLayout(window.localStorage, cwd)
    let tree = saved.tree
    const available = new Set(snapshot.chats.map((chat) => chat.paneId))
    tree = pruneTabs(tree, available)
    if (!tree || !paneIds(tree).length) tree = { kind: 'pane' as const, id: snapshot.selectedPaneId }
    else if (!tabIds(tree).includes(snapshot.selectedPaneId)) {
      tree = selectTab(tree, paneIds(tree)[0]!, snapshot.selectedPaneId)
    } else if (!paneIds(tree).includes(snapshot.selectedPaneId) && !isViewTabId(tabOwner(tree, snapshot.selectedPaneId)!)) {
      // Behind a sibling chat it surfaces; behind a view it stays where the last session left it.
      tree = selectTab(tree, paneIds(tree)[0]!, snapshot.selectedPaneId)
    }
    return { ...saved, tree: withBrowser(tree!) }
  })
  // Objects rather than strings: repeating the same message restarts its dismissal timer.
  const [error, setError] = useState<{ text: string } | null>(null)
  const [notice, setNotice] = useState<{ text: string } | null>(null)
  const latestSnapshot = useRef(snapshot)
  latestSnapshot.current = snapshot
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), ERROR_TTL_MS)
    return () => window.clearTimeout(timer)
  }, [error])
  const fail = useCallback((reason: unknown) => setError({ text: errorMessage(reason) }), [])
  const clearError = useCallback(() => setError(null), [])
  const reportRemoval = useCallback((ids: string[], label: string) => {
    const rows = latestSnapshot.current.chats.filter((row) => ids.includes(row.paneId))
    setNotice({ text: removalNotice(label, rows) })
  }, [])
  const [busy, setBusy] = useState(false)
  const [selectionToConfirm, setSelectionToConfirm] = useState<string | null>(null)
  const pending = useRef(false)
  const selected = useRef(snapshot.selectedPaneId)
  const current = useRef(layout)
  current.current = layout
  // Main hears about chats only: a tile showing a view has no visible chat, its chats are retained.
  const idsKey = JSON.stringify(chatPaneIds(layout.tree))
  const tabsKey = JSON.stringify(chatTabIds(layout.tree))
  const hasTiles = paneIds(layout.tree).length > 0
  const release = useCallback(() => {
    pending.current = false
    setSelectionToConfirm(null)
    setBusy(false)
  }, [])

  useEffect(() => {
    saveLayout(window.localStorage, cwd, { ...layout, views: pruneViewScopes(layout.views, layout.tree) })
  }, [cwd, layout])

  useEffect(() => {
    if (!hasTiles) return
    let active = true
    void window.closedai.chat.setVisiblePanes(cwd, JSON.parse(idsKey) as string[], JSON.parse(tabsKey) as string[]).catch((reason: unknown) => {
      if (active) fail(reason)
    })
    return () => { active = false }
  }, [cwd, idsKey, tabsKey, hasTiles, fail])

  const chatIdsKey = useMemo(() => {
    const ids = snapshot.chats.map((chat) => chat.paneId)
    ids.sort()
    return ids.join('\0')
  }, [snapshot.chats.map((chat) => chat.paneId).sort().join('\0')])

  // Drop archived or removed chats from the saved tree without touching tab focus.
  useEffect(() => {
    const available = new Set(chatIdsKey.split('\0').filter(Boolean))
    setLayout((value) => {
      const tree = pruneTabs(value.tree, available)
      return tree === value.tree ? value : { ...value, tree: tree! }
    })
  }, [chatIdsKey, cwd])

  // History/search selection focuses an existing tab or adds one to the focused tile.
  // Split/add operations manage their own destination while main announces selection.
  // LayoutEffect keeps the destination pane mounted before paint. It must not depend on
  // `chats` row updates: streaming refreshes the drawer every few hundred ms and
  // re-running selectTab there rewrote the tree and starved provider runtimes.
  useLayoutEffect(() => {
    // Workspace events are delivered in a React transition. An IPC reply can arrive
    // first; do not prune the new tab against the previous workspace snapshot.
    if (selectionToConfirm) {
      const chats = latestSnapshot.current.chats
      if (snapshot.selectedPaneId !== selectionToConfirm ||
          !chats.some((chat) => chat.paneId === selectionToConfirm)) return
      release()
    } else if (pending.current) return
    const next = snapshot.selectedPaneId
    const previous = selected.current
    selected.current = next
    setLayout((value) => {
      let tree: ChatLayout | null = value.tree
      // A selection this hook made itself (a view tile focusing the chat it follows) is already
      // placed; re-asserting it would pull the chat out from behind the view.
      if (next === previous && tree && tabIds(tree).includes(next)) return value
      if (!tree || !paneIds(tree).length) tree = withBrowser({ kind: 'pane', id: next })
      else if (!tabIds(tree).includes(next)) {
        const anchor = paneIds(tree).includes(previous) ? previous : paneIds(tree)[0]!
        tree = selectTab(tree, anchor, next)
      } else if (!isChatTabActive(tree, next)) {
        const anchor = paneIds(tree).includes(previous) ? previous : paneIds(tree)[0]!
        tree = selectTab(tree, anchor, next)
      }
      return tree === value.tree ? value : { ...value, tree: tree! }
    })
  }, [snapshot.selectedPaneId, busy, cwd, selectionToConfirm, release])

  // A confirmation that never arrives would leave every structural control disabled. Releasing
  // re-runs the reconciliation above against the latest snapshot, which drops any tab main never opened.
  useEffect(() => {
    if (!selectionToConfirm) return
    const timer = window.setTimeout(() => {
      release()
      fail(new Error('The workspace did not confirm the new tab in time; the layout was refreshed from the current chats'))
    }, CONFIRM_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [selectionToConfirm, release, fail])

  // Focusing a view tile selects the chat it shows; the guard above keeps the view in front.
  const selectViewChat = useCallback(async (viewId: string): Promise<void> => {
    const { chatId } = viewScope(current.current.tree, viewId, current.current.views, latestSnapshot.current.selectedPaneId)
    if (chatId === latestSnapshot.current.selectedPaneId) return
    selected.current = chatId
    await window.closedai.chat.selectPane(chatId)
  }, [])

  const focusPane = useCallback(async (id: string): Promise<void> => {
    // Menu focus restoration must not select the departing pane mid-operation.
    if (pending.current) return
    try {
      if (isViewTabId(id)) await selectViewChat(id)
      else await window.closedai.chat.selectPane(id)
      clearError()
    } catch (reason) { fail(reason) }
  }, [clearError, fail, selectViewChat])

  // A null edge adds a tab in the target tile without adding a split. Without an id a chat is
  // created: a blank one, or whatever `create` makes (a continuation seeded from another chat).
  const dock = useCallback(async (id: string | null, target: string, edge: DockEdge | null, singleTab = false,
    create?: () => Promise<string>): Promise<void> => {
    if (pending.current) return
    if (id === BROWSER_PANE_ID) {
      if (edge) setLayout((value) => ({ ...value, tree: dockBrowser(value.tree, target, edge, crypto.randomUUID()) }))
      return
    }
    if (target === WORKSPACE_DOCK_ID || (target === BROWSER_PANE_ID && (!id || !edge))) return
    // A view moves with no IPC: main never hears of it, and the tree is the whole record.
    const view = id !== null && isViewTabId(id)
    pending.current = true
    setBusy(true)
    clearError()
    try {
      const treeBefore = current.current.tree
      const sourceOwner = id ? tabOwner(treeBefore, id) : null
      const sourceHasSiblings = sourceOwner && tabIds(treeBefore).some((tab) => tab !== id && tabOwner(treeBefore, tab) === sourceOwner)
      if (!view && edge && chatPaneIds(treeBefore).length >= 32 && (!id || !paneIds(treeBefore).includes(id) || (singleTab && sourceHasSiblings))) {
        throw new Error('The workspace already has 32 visible chats')
      }
      if (!id && !isViewTabId(target)) await window.closedai.chat.selectPane(target)
      const added = view ? id : id ? await window.closedai.chat.openChat(id) : create ? await create() : await window.closedai.chat.newPeer()
      if (!view) selected.current = added
      setLayout((value) => {
        // A following view leaving its tile is pinned to the chat it showed; whole-tile moves keep their chats.
        const views = view && (singleTab || !edge)
          ? pinOnMove(value.tree, added, edge ? null : tabOwner(value.tree, target), value.views, latestSnapshot.current.selectedPaneId)
          : value.views
        if (singleTab || (id && !edge)) return { ...value, views,
          tree: moveTab(value.tree, added, target, edge, crypto.randomUUID()) }
        // Dragging a hidden sidebar tab out leaves its sibling tabs in their tile.
        const tree = edge && tabOwner(value.tree, added) && !paneIds(value.tree).includes(added)
          ? removeTab(value.tree, added)! : value.tree
        return { ...value, views, tree: edge
          ? dockPane(tree, added, target, edge, crypto.randomUUID())
          : addTab(tree, target, added) }
      })
      if (view) release()
      else setSelectionToConfirm(added)
    } catch (reason) {
      fail(reason)
      release()
    }
  }, [clearError, fail, release])

  const newChat = useCallback((target: string) => dock(null, target, null), [dock])

  // "Continue in new chat": the digest-seeded chat opens as a tab in the source's own tile, so the
  // old conversation stays one click away while the new one starts. Main's refusal (for example a
  // turn still running) surfaces through the same error line as any other layout operation.
  const continueChat = useCallback((sourceId: string, threadId: string | null, modelId: string | null) => {
    const target = tabOwner(current.current.tree, sourceId) ?? sourceId
    return dock(null, target, null, false, () => window.closedai.chat.continueInNewPeer({ paneId: sourceId, threadId }, modelId))
  }, [dock])

  /** Show a tab; a chat not yet open joins `anchor`'s tile (else the first). A view also focuses its tile. */
  const activateTab = useCallback(async (id: string, anchor?: string): Promise<void> => {
    if (pending.current) return
    const view = isViewTabId(id)
    if (!view) selected.current = id
    setLayout((value) => {
      const tile = anchor && paneIds(value.tree).includes(anchor) ? anchor : paneIds(value.tree)[0]!
      return { ...value, tree: selectTab(value.tree, tile, id) }
    })
    try {
      if (view) await selectViewChat(id)
      else await window.closedai.chat.openChat(id)
      clearError()
    } catch (reason) {
      fail(reason)
    }
  }, [clearError, fail, selectViewChat])

  /** Open a view in a tile (or select the tile's existing one of that kind). No IPC: views are renderer state. */
  const openView = useCallback((kind: ViewKind, target: string): void => {
    if (pending.current) return
    const tree = current.current.tree
    const tile = paneIds(tree).includes(target) ? target : tabOwner(tree, target) ?? paneIds(tree)[0]!
    const existing = tileView(tree, tile, kind)
    if (existing) { void activateTab(existing); return }
    setLayout((value) => ({ ...value, tree: addTab(value.tree, tile, viewTabId(kind, crypto.randomUUID())) }))
  }, [activateTab])

  const pinView = useCallback((viewId: string, chatId: string | null): void => {
    setLayout((value) => {
      const views = { ...value.views }
      if (chatId) views[viewId] = { pinnedChatId: chatId }
      else delete views[viewId]
      return { ...value, views: Object.keys(views).length ? views : undefined }
    })
  }, [])

  // Keyboard counterpart to dragging a tab onto another tile's header: no IPC, the chat stays selected.
  const moveTabToTile = useCallback((id: string, direction: TileDirection): void => {
    if (pending.current) return
    setLayout((value) => {
      const target = neighborTile(value.tree, id, direction)
      if (!target) return value
      const views = pinOnMove(value.tree, id, target, value.views, latestSnapshot.current.selectedPaneId)
      return { ...value, views, tree: moveTab(value.tree, id, target, null, crypto.randomUUID()) }
    })
  }, [])

  // Close and hide recompute the tree when they commit: a divider resize during the round trip must
  // survive, so the snapshot taken before awaiting only decides what the operation needs from main.
  const closeTab = useCallback(async (id: string): Promise<void> => {
    const tree = current.current.tree
    const remaining = removeTab(tree, id)
    if (!remaining || !paneIds(remaining).length || pending.current) return
    pending.current = true
    setBusy(true)
    clearError()
    try {
      const owner = tabOwner(tree, id)
      if (owner === id) {
        const sibling = tabIds(tree).find((tab) => tab !== id && tabOwner(tree, tab) === owner)
        const next = sibling ? tabOwner(remaining, sibling)! : paneIds(remaining)[0]!
        // The tile's next tab takes the selection; when that is a view, the selection moves to a
        // visible chat only if the closed tab held it, so a view-only tile keeps following it.
        const nextChat = !isViewTabId(next) ? next : selected.current === id ? chatPaneIds(remaining)[0] ?? null : null
        if (nextChat) {
          // Open also reattaches a tab that was parked and trimmed in the background.
          await window.closedai.chat.openChat(nextChat)
          selected.current = nextChat
          setSelectionToConfirm(nextChat)
        } else {
          release()
        }
      } else {
        release()
      }
      setLayout((value) => {
        const next = removeTab(value.tree, id)
        return next && paneIds(next).length ? { ...value, tree: next } : value
      })
      if (!isViewTabId(id)) reportRemoval([id], 'Tab closed')
    } catch (reason) {
      fail(reason)
      release()
    }
  }, [clearError, fail, release, reportRemoval])

  const hide = useCallback(async (id: string): Promise<void> => {
    const tree = current.current.tree
    const remaining = removePane(tree, id)
    if (!remaining || !paneIds(remaining).length || pending.current) return
    pending.current = true
    try {
      if (selected.current === id) {
        selected.current = paneIds(remaining)[0]!
        await window.closedai.chat.selectPane(selected.current)
      }
      setLayout((value) => {
        const next = removePane(value.tree, id)
        return next && paneIds(next).length ? { ...value, tree: next } : value
      })
      clearError()
      reportRemoval(tabIds(tree).filter((tab) => tabOwner(tree, tab) === id), 'Pane hidden')
    } catch (reason) { fail(reason) }
    finally { pending.current = false }
  }, [clearError, fail, reportRemoval])

  const resize = useCallback((id: string, ratio: number) => {
    setLayout((value) => ({ ...value, tree: resizeSplit(value.tree, id, ratio) }))
  }, [])
  // Ctrl+W acts on what the selected tile shows: a view in front closes before the chat behind it.
  const closeFocused = useCallback(async (): Promise<void> => {
    const tree = current.current.tree
    const owner = tabOwner(tree, selected.current)
    const id = owner && isViewTabId(owner) ? owner : selected.current
    const action = focusedCloseAction(tree, id)
    if (action === 'close-tab') await closeTab(id)
    else if (action === 'hide-pane' && owner) await hide(owner)
  }, [closeTab, hide])
  /** Title-bar toggle: close the selected tile's view of this kind when it is in front, else open it there. */
  const toggleView = useCallback(async (kind: ViewKind): Promise<void> => {
    const tree = current.current.tree
    const tile = tabOwner(tree, selected.current) ?? paneIds(tree)[0]!
    const existing = tileView(tree, tile, kind)
    if (existing && existing === tile) await closeTab(existing)
    else openView(kind, tile)
  }, [closeTab, openView])
  // A preset is a starting arrangement: open tiles keep their tab groups, missing slots get new
  // chats, and the result is saved like any hand-built tree, so every drag and resize still applies.
  const arrange = useCallback(async (preset: LayoutPreset, size: CanvasSize): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    clearError()
    try {
      const { groups, missing } = assignGroups(current.current.tree, presetSlots(preset))
      const visible = chatPaneIds(current.current.tree)
      const retained = chatTabIds(current.current.tree)
      let created: string | null = null
      for (let index = 0; index < missing; index++) {
        created = await window.closedai.chat.newPeer()
        groups.push(singleGroup(created))
        visible.push(created)
        retained.push(created)
        // Register at once: main trims attached chats beyond its cap and discards blank unselected
        // ones unless they are visible, and the tree only registers them after every slot exists.
        await window.closedai.chat.setVisiblePanes(cwd, visible, retained)
      }
      let tree = presetLayout(preset, groups, size, () => crypto.randomUUID())
      // A merged tile keeps the selected chat active rather than parking it behind a sibling tab.
      if (!created && tabOwner(tree, selected.current) && !paneIds(tree).includes(selected.current)) {
        tree = selectTab(tree, paneIds(tree)[0]!, selected.current)
      }
      setLayout({ tree: withBrowser(tree), browserVisible: preset.kind !== 'grid' })
      if (created) {
        selected.current = created
        setSelectionToConfirm(created)
      } else {
        release()
      }
    } catch (reason) {
      fail(reason)
      release()
    }
  }, [cwd, clearError, fail, release])
  const toggleBrowser = useCallback(() => setLayout((value) => ({ ...value, browserVisible: !value.browserVisible })), [])
  const showBrowser = useCallback(() => setLayout((value) => value.browserVisible ? value : { ...value, browserVisible: true }), [])
  return {
    ...layout, error: error?.text ?? '', notice: notice?.text ?? '', busy, dock, newChat, continueChat, focusPane,
    activateTab, openView, toggleView, pinView, moveTabToTile, closeTab, hide, closeFocused, resize, arrange,
    toggleBrowser, showBrowser
  }
}
