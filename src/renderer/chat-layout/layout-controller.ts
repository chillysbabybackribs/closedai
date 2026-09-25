import { ensureExpandedGroup, expandAllDockedGroups, layoutGroups } from './layout-docking.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import { errorMessage } from '../error-message.js'
import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, chatPaneIds, isViewTabId, withBrowser, dockBrowser, dockPane, paneIds, readLayout, removePane, resizeSplit, saveLayout, type ChatLayout, type DockEdge, type SplitResizePhase } from './layout-tree.js'
import { addTab, chatTabIds, focusChatTabInLayout, focusedCloseAction, isChatTabActive, moveTab, neighborTile, pruneTabs, removeTab, selectTab, tabIds, tabOwner, type TileDirection } from './layout-tabs.js'
import { isWorkspaceViewKind, pinOnMove, pruneViewScopes, tileView, viewScope, viewTabId, workspaceView, type ViewKind } from './layout-views.js'
import { removalNotice } from './layout-copy.js'
import { adoptTabs, initialWindowTree } from './layout-windows.js'
import { appWindow, onAppWindowCommand, otherWindowFocused, tabsHeldElsewhere, useAppWindows } from '../app-windows/app-window-store.js'
import { assignGroups, presetLayout, presetSlots, singleGroup, type CanvasSize, type LayoutPreset } from './layout-presets.js'
const ERROR_TTL_MS = 8000
/** Main announces a selection within one workspace event; past this the layout resyncs instead of staying locked. */
const CONFIRM_TIMEOUT_MS = 5000

/** The component owning this hook is keyed by project directory. */
export function useChatLayout(
  getSnapshot: () => ChatWorkspaceSnapshot,
  layoutRevision: string
) {
  const snapshot = getSnapshot()
  const cwd = snapshot.workspace?.cwd ?? snapshot.selected.cwd
  // A detached window keeps its own saved layout and never hosts the browser.
  const self = appWindow()
  const windows = useAppWindows()
  const [layout, setLayout] = useState(() => {
    const saved = readLayout(window.localStorage, cwd, self.id)
    const tree = initialWindowTree(saved.tree, {
      available: new Set(snapshot.chats.map((chat) => chat.paneId)), elsewhere: tabsHeldElsewhere(),
      selectedPaneId: snapshot.selectedPaneId, detached: !self.main, initialTabs: self.initialTabs,
      fallbackView: () => viewTabId('history', crypto.randomUUID())
    })
    return { ...saved, tree: withBrowser(expandAllDockedGroups(ensureExpandedGroup(tree))) }
  })
  // Objects rather than strings: repeating the same message restarts its dismissal timer.
  const [error, setError] = useState<{ text: string } | null>(null)
  const [notice, setNotice] = useState<{ text: string } | null>(null)
  const latestSnapshot = useRef(getSnapshot)
  latestSnapshot.current = getSnapshot
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
    const rows = latestSnapshot.current().chats.filter((row) => ids.includes(row.paneId))
    setNotice({ text: removalNotice(label, rows) })
  }, [])
  const [busy, setBusy] = useState(false)
  const [selectionToConfirm, setSelectionToConfirm] = useState<string | null>(null)
  const pending = useRef(false)
  // This window's own selection: a chat another window selects is never recorded here.
  const selected = useRef(chatTabIds(layout.tree).includes(snapshot.selectedPaneId)
    ? snapshot.selectedPaneId : chatPaneIds(layout.tree)[0] ?? snapshot.selectedPaneId)
  const current = useRef(layout)
  current.current = layout
  // Main hears about chats only: a tile showing a view has no visible chat, its chats are retained.
  const idsKey = JSON.stringify([...new Set(chatPaneIds(layout.tree))])
  const tabsKey = JSON.stringify(chatTabIds(layout.tree))
  const hasTiles = paneIds(layout.tree).length > 0
  const release = useCallback(() => {
    pending.current = false
    setSelectionToConfirm(null)
    setBusy(false)
  }, [])

  const layoutPersist = useRef(layout)
  layoutPersist.current = layout
  useEffect(() => {
    const persist = (): void => {
      const value = layoutPersist.current
      saveLayout(window.localStorage, cwd, { ...value, views: pruneViewScopes(value.views, value.tree) }, self.id)
    }
    const timer = window.setTimeout(persist, 250)
    return () => {
      window.clearTimeout(timer)
      persist()
    }
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
    const ids = getSnapshot().chats.map((chat) => chat.paneId)
    ids.sort()
    return ids.join('\0')
  }, [layoutRevision])

  // Drop archived or removed chats from the saved tree without touching tab focus.
  useEffect(() => {
    const available = new Set(chatIdsKey.split('\0').filter(Boolean))
    setLayout((value) => {
      const pruned = pruneTabs(value.tree, available)
      const tree = pruned ? expandAllDockedGroups(ensureExpandedGroup(pruned)) : pruned
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
      const chats = latestSnapshot.current().chats
      if (getSnapshot().selectedPaneId !== selectionToConfirm ||
          !chats.some((chat) => chat.paneId === selectionToConfirm)) return
      release()
    } else if (pending.current) return
    const next = getSnapshot().selectedPaneId
    // Another window's chat, or a chat opened while another window was in front, is not this
    // window's to show; the main window adopts an unclaimed one once it is in front again.
    if (!tabIds(current.current.tree).includes(next) && (!self.main || tabsHeldElsewhere().has(next) || otherWindowFocused())) return
    const previous = selected.current
    selected.current = next
    setLayout((value) => {
      let tree: ChatLayout | null = value.tree
      // A selection this hook made itself (a view tile focusing the chat it follows) is already
      // placed; re-asserting it would pull the chat out from behind the view.
      if (next === previous && tree && tabIds(tree).includes(next) && isChatTabActive(tree, next)) return value
      if (!tree || !paneIds(tree).length) tree = withBrowser({ kind: 'pane', id: next })
      else if (!tabIds(tree).includes(next)) {
        const anchor = paneIds(tree).includes(previous) ? previous : paneIds(tree)[0]!
        tree = selectTab(tree, anchor, next)
      } else if (!isChatTabActive(tree, next)) {
        tree = focusChatTabInLayout(tree, next)
      }
      return tree === value.tree ? value : { ...value, tree: tree! }
    })
  }, [layoutRevision, busy, cwd, selectionToConfirm, release, windows])

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
    const { chatId } = viewScope(current.current.tree, viewId, current.current.views, latestSnapshot.current().selectedPaneId)
    if (chatId === latestSnapshot.current().selectedPaneId) return
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
    if (id && await revealedElsewhere(current.current.tree, id)) return
    // A view moves with no IPC: main never hears of it, and the tree is the whole record.
    const view = id !== null && isViewTabId(id)
    pending.current = true
    setBusy(true)
    clearError()
    try {
      const treeBefore = current.current.tree
      const sourceOwner = id ? tabOwner(treeBefore, id) : null
      const sourceHasSiblings = sourceOwner && tabIds(treeBefore).some((tab) => tab !== id && tabOwner(treeBefore, tab) === sourceOwner)
      if (!view && edge && layoutGroups(treeBefore).filter((group) => !isViewTabId(group.id)).length >= 32 && (!id || !paneIds(treeBefore).includes(id) || (singleTab && sourceHasSiblings))) {
        throw new Error('The workspace already has 32 visible chats')
      }
      const anchor = !id && !isViewTabId(target) ? target : undefined
      const added = view ? id : id ? await window.closedai.chat.openChat(id) : create ? await create() : await window.closedai.chat.newPeer(anchor)
      if (!view) selected.current = added
      setLayout((value) => {
        // A following view leaving its tile is pinned to the chat it showed; whole-tile moves keep their chats.
        const views = view && (singleTab || !edge)
          ? pinOnMove(value.tree, added, edge ? null : tabOwner(value.tree, target), value.views, latestSnapshot.current().selectedPaneId)
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
    if (pending.current || await revealedElsewhere(current.current.tree, id)) return
    const view = isViewTabId(id)
    if (!view) selected.current = id
    const focusTab = (): void => {
      setLayout((value) => {
        const tile = anchor && paneIds(value.tree).includes(anchor) ? anchor : paneIds(value.tree)[0]!
        return { ...value, tree: selectTab(value.tree, tile, id) }
      })
    }
    try {
      if (view) {
        focusTab()
        await selectViewChat(id)
      } else {
        // Load the saved transcript before the tab panel unhides so the pane does not flash empty
        // and jump when cached messages land.
        await window.closedai.chat.openChat(id)
        focusTab()
      }
      clearError()
    } catch (reason) {
      fail(reason)
    }
  }, [clearError, fail, selectViewChat])

  /** Open a view in a tile (or select the tile's existing one of that kind). No IPC: views are renderer state. */
  const openView = useCallback((kind: ViewKind, target: string): void => {
    if (pending.current) return
    const tree = current.current.tree
    const anywhere = isWorkspaceViewKind(kind) ? workspaceView(tree, kind) : null
    if (anywhere) { void activateTab(anywhere); return }
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
      const views = pinOnMove(value.tree, id, target, value.views, latestSnapshot.current().selectedPaneId)
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
        const removed = removeTab(value.tree, id)
        const next = removed ? ensureExpandedGroup(removed) : removed
        return next && paneIds(next).length ? { ...value, tree: next } : value
      })
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
        const removed = removePane(value.tree, id)
        const next = removed ? ensureExpandedGroup(removed) : removed
        return next && paneIds(next).length ? { ...value, tree: next } : value
      })
      clearError()
      reportRemoval(tabIds(tree).filter((tab) => tabOwner(tree, tab) === id), 'Pane hidden')
    } catch (reason) { fail(reason) }
    finally { pending.current = false }
  }, [clearError, fail, reportRemoval])

  const resize = useCallback((id: string, ratio: number, phase: SplitResizePhase = 'commit') => {
    if (phase === 'cancel') return
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
  // Move a tab into a new window of its own; the last tab stays, so this window is never empty.
  const detachTab = useCallback(async (id: string): Promise<void> => {
    const remaining = removeTab(current.current.tree, id)
    if (pending.current || !remaining || !paneIds(remaining).length) return
    try {
      await window.closedai.windows.detachTabs(cwd, [id])
      if (selected.current === id) selected.current = chatPaneIds(remaining)[0] ?? id
      setLayout((value) => ({ ...value, tree: withoutTab(value.tree, id) }))
      clearError()
    } catch (reason) { fail(reason) }
  }, [cwd, clearError, fail])

  // A detached window's tab goes back to the main window; its last tab takes the window with it.
  const returnTab = useCallback(async (id: string): Promise<void> => {
    if (pending.current || self.main) return
    const remaining = removeTab(current.current.tree, id)
    try {
      await window.closedai.windows.returnTabs([id])
      if (!remaining || !paneIds(remaining).length) await window.closedai.window.close()
      else setLayout((value) => ({ ...value, tree: withoutTab(value.tree, id) }))
    } catch (reason) { fail(reason) }
  }, [fail])

  const activateTabRef = useRef(activateTab)
  activateTabRef.current = activateTab
  useEffect(() => onAppWindowCommand((command) => {
    if (command.type === 'activateTab') void activateTabRef.current(command.tabId)
    else if (command.type === 'adoptTabs') {
      setLayout((value) => ({ ...value, tree: adoptTabs(value.tree, command.tabIds, tabOwner(value.tree, selected.current)) }))
    }
  }), [])

  // A window brought to the front makes its own chat the selected one, so the keyboard, menus and
  // tools act on what the user is looking at rather than on a chat in the window behind.
  useEffect(() => {
    const claimSelection = (): void => {
      const tree = current.current.tree
      const next = latestSnapshot.current().selectedPaneId
      if (pending.current || tabIds(tree).includes(next) || (self.main && !tabsHeldElsewhere().has(next))) return
      const own = chatTabIds(tree).includes(selected.current) ? selected.current : chatPaneIds(tree)[0]
      if (own) void window.closedai.chat.selectPane(own).catch(() => {})
    }
    if (document.hasFocus()) claimSelection()
    window.addEventListener('focus', claimSelection)
    return () => window.removeEventListener('focus', claimSelection)
  }, [])

  const toggleBrowser = useCallback(() => setLayout((value) => ({ ...value, browserVisible: !value.browserVisible })), [])
  const showBrowser = useCallback(() => setLayout((value) => value.browserVisible ? value : { ...value, browserVisible: true }), [])
  return {
    ...layout, browserVisible: self.main && layout.browserVisible, detached: !self.main,
    error: error?.text ?? '', notice: notice?.text ?? '', busy, dock, newChat, continueChat, focusPane,
    activateTab, openView, toggleView, pinView, moveTabToTile, closeTab, hide, closeFocused, resize, arrange,
    toggleBrowser, showBrowser, detachTab, returnTab
  }
}

/** A tab another window holds is brought forward there instead of being opened twice. */
async function revealedElsewhere(tree: ChatLayout, id: string): Promise<boolean> {
  if (tabIds(tree).includes(id) || !tabsHeldElsewhere().has(id)) return false
  return window.closedai.windows.revealTab(id)
}

function withoutTab(tree: ChatLayout, id: string): ChatLayout {
  const removed = removeTab(tree, id)
  const next = removed ? ensureExpandedGroup(removed) : removed
  return next && paneIds(next).length ? next : tree
}
