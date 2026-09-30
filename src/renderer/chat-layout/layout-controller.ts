import { ensureExpandedGroup, layoutGroups } from './layout-docking.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import { errorMessage } from '../error-message.js'
import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, chatPaneIds, isViewTabId, withBrowser, dockBrowser, dockPane, paneIds, readLayout, removePane, resizeSplit, saveLayout, type ChatLayout, type DockEdge, type SplitResizePhase } from './layout-tree.js'
import { addTab, chatTabIds, focusChatTabInLayout, focusedCloseAction, isChatTabActive, moveTab, neighborTile, pruneTabs, removeTab, selectTab, tabIds, tabOwner, type TileDirection } from './layout-tabs.js'
import { isWorkspaceViewKind, pinOnMove, pruneViewScopes, tileView, viewScope, viewTabId, workspaceView, type ViewKind } from './layout-views.js'
import { removalNotice } from './layout-copy.js'
import { readQuickChatModel, rememberQuickChatModel } from './quick-chat-model.js'
import { notepadChats, pruneNotepadChats } from '../notepad/notepad-layout.js'
import { adoptTabs, initialWindowTree } from './layout-windows.js'
import { adoptsUnheldChats, appWindow, isFrontWindow, onAppWindowCommand, tabsHeldElsewhere, useAppWindows } from '../app-windows/app-window-store.js'
import { chatInNewWindow, floatBeside, groupWindow, minimizeWindow, raiseWindow, restoreWindow } from './floating/window-layout.js'
import { setWindowOnTop, tileWindows } from './floating/window-arrange.js'
import { absorbCrossDockAtPointer } from './floating/cross-window-dock-target.js'
import { crossWindowDockCanvasSize } from '../app-windows/cross-window-dock-store.js'
import { assignGroups, presetLayout, presetSlots, singleGroup, type CanvasSize, type LayoutPreset } from './layout-presets.js'
import { autoPlace, type WindowOpen } from './auto-place.js'
const ERROR_TTL_MS = 8000
/** Main announces a selection within one workspace event; past this the layout resyncs instead of staying locked. */
const CONFIRM_TIMEOUT_MS = 5000

/**
 * The component owning this hook is keyed by the space it shows. `spaceId` names the main window's
 * saved layout (several spaces can share a project); a detached window keeps its project's own.
 */
export function useChatLayout(
  getSnapshot: () => ChatWorkspaceSnapshot,
  layoutRevision: string,
  spaceId?: string
) {
  const snapshot = getSnapshot()
  const cwd = snapshot.workspace?.cwd ?? snapshot.selected.cwd
  // A detached window keeps its own saved layout and never hosts the browser.
  const self = appWindow()
  const layoutKey = self.main && spaceId ? spaceId : cwd
  const windows = useAppWindows()
  const [restored] = useState(() => readLayout(window.localStorage, layoutKey, self.id))
  const [layout, setLayout] = useState(() => {
    const { focused: _focused, ...saved } = restored
    const tree = initialWindowTree(saved.tree, {
      available: new Set(snapshot.chats.map((chat) => chat.paneId)), elsewhere: tabsHeldElsewhere(),
      selectedPaneId: snapshot.selectedPaneId, detached: !self.main, initialTabs: self.initialTabs,
      fallbackView: () => viewTabId('history', crypto.randomUUID())
    })
    return { ...saved, tree: withBrowser(tree) }
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
  // This window's own selection: a chat another window selects is never recorded here. Main's
  // selection names the window in front; every other window resumes the chat it last had focused.
  const selected = useRef(chatTabIds(layout.tree).includes(snapshot.selectedPaneId) ? snapshot.selectedPaneId
    : restored.focused && chatPaneIds(layout.tree).includes(restored.focused) ? restored.focused
      : chatPaneIds(layout.tree)[0] ?? snapshot.selectedPaneId)
  const current = useRef(layout)
  current.current = layout
  // Main hears about chats only: a tile showing a view has no visible chat, its chats are retained.
  // The browser's quick chat and each notepad window's chat are visible too, so main keeps them
  // attached and streams them.
  const browserChat = self.main && layout.browserChat && snapshot.chats.some((chat) => chat.paneId === layout.browserChat)
    ? layout.browserChat : null
  const browserChatModel = browserChat ? snapshot.chats.find((chat) => chat.paneId === browserChat)?.modelId ?? null : null
  useEffect(() => {
    if (browserChatModel) rememberQuickChatModel(window.localStorage, browserChatModel)
  }, [browserChatModel])
  const sideChats = (value: typeof layout): string[] => [...notepadChats(value.tree), ...(value.browserChat ? [value.browserChat] : [])]
  const idsKey = JSON.stringify([...new Set([...chatPaneIds(layout.tree), ...notepadChats(layout.tree), ...(browserChat ? [browserChat] : [])])])
  const tabsKey = JSON.stringify(chatTabIds(layout.tree))
  const hasTiles = paneIds(layout.tree).length > 0
  const release = useCallback(() => {
    pending.current = false
    setSelectionToConfirm(null)
    setBusy(false)
  }, [])

  const layoutPersist = useRef(layout)
  layoutPersist.current = layout
  // A selection change is saved too (the focused chat is read at write time), and a reload or quit
  // inside the debounce still writes the last change.
  const mainSelection = snapshot.selectedPaneId
  useEffect(() => {
    const persist = (): void => {
      const value = layoutPersist.current
      const focused = chatTabIds(value.tree).includes(selected.current) ? selected.current : undefined
      saveLayout(window.localStorage, layoutKey, { ...value, views: pruneViewScopes(value.views, value.tree), focused }, self.id)
    }
    const timer = window.setTimeout(persist, 250)
    window.addEventListener('pagehide', persist)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pagehide', persist)
      persist()
    }
  }, [layoutKey, layout, mainSelection])

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
      const pruned = pruneNotepadChats(pruneTabs(value.tree, available), available)
      const tree = pruned ? ensureExpandedGroup(pruned) : pruned
      const staleBrowserChat = value.browserChat !== undefined && !available.has(value.browserChat)
      if (tree === value.tree && !staleBrowserChat) return value
      const { browserChat: _stale, ...rest } = value
      return { ...(staleBrowserChat ? rest : value), tree: tree! }
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
    // The browser's quick chat floats over the page; a selection never pulls it into a tile.
    if (next === current.current.browserChat) return
    // Another window's chat is never opened twice. A chat no window holds yet (a new chat, one a
    // tool opened) goes to the window in front; the main window takes it when none is.
    if (!tabIds(current.current.tree).includes(next) && (tabsHeldElsewhere().has(next) || !adoptsUnheldChats())) return
    const previous = selected.current
    selected.current = next
    setLayout((value) => {
      let tree: ChatLayout | null = value.tree
      // A selection this hook made itself (a view tile focusing the chat it follows), or the one it
      // mounted with, is already placed; re-asserting it would pull the chat out from behind a view
      // or out of a minimized window. Only a chat behind a sibling chat comes forward.
      if (next === previous && tree && tabIds(tree).includes(next) && !behindSiblingChat(tree, next)) return value
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
        // Split beside a floating window, the new window floats too, cascaded from it.
        return { ...value, views, tree: edge
          ? floatBeside(dockPane(tree, added, target, edge, crypto.randomUUID()), added, target)
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

  // The tiled canvas's last measured size: where a window opened from the dock fits (auto-place.ts).
  const canvasSize = useRef<CanvasSize>({ width: 0, height: 0 })
  const setCanvasSize = useCallback((size: CanvasSize) => { canvasSize.current = size }, [])
  /**
   * Open a new window (a dock chat, the notepad). `change` gets `tile`, which halves the roomiest
   * tile for `id` and returns null when none can be halved, so the caller floats it instead. A
   * tiled window ends any maximized one, or it would open hidden behind it.
   */
  const openWindowIn = (value: typeof layout, change: WindowOpen): typeof layout => {
    let tiled = false
    const tile = (tree: ChatLayout, id: string): ChatLayout | null => {
      const next = autoPlace(tree, id, { ...canvasSize.current, browserVisible: self.main && value.browserVisible },
        crypto.randomUUID(), tabOwner(tree, selected.current))
      if (next) tiled = true
      return next
    }
    const tree = change(value.tree, tile)
    if (tree === value.tree) return value
    if (!tiled || !value.maximized) return { ...value, tree }
    const { maximized: _cleared, ...rest } = value
    return { ...rest, tree }
  }
  const openWindow = useCallback((change: WindowOpen): void => {
    if (pending.current) return
    setLayout((value) => openWindowIn(value, change))
  }, [])

  /** A blank chat in a window of its own: tiled into the layout when a tile can be halved, else floating. */
  const newChatWindow = useCallback(async (): Promise<void> => {
    if (pending.current) return
    const host = paneIds(current.current.tree).find((id) => !isViewTabId(id))
    if (!host) return
    pending.current = true
    setBusy(true)
    clearError()
    try {
      const added = await window.closedai.chat.newPeer(host)
      selected.current = added
      setLayout((value) => openWindowIn(value, (tree, tile) => tile(tree, added)
        ?? chatInNewWindow(tree, added, host, crypto.randomUUID())))
      setSelectionToConfirm(added)
    } catch (reason) {
      fail(reason)
      release()
    }
  }, [clearError, fail, release])

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
    // The quick chat never joins a tile (History, search, Start): it opens over the page instead.
    if (id === current.current.browserChat) {
      setLayout((value) => ({ ...value, browserVisible: true, browserChatOpen: true }))
      return
    }
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
    if (pending.current) return
    // A layout always holds a window, so closing the last one minimizes it: only the dock is left.
    if (!remaining || !paneIds(remaining).length) {
      setLayout((value) => {
        const docked = minimizeWindow(value.tree, id)
        return docked === value.tree ? value : { ...value, tree: docked }
      })
      return
    }
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
      reportRemoval(tabIds(tree).filter((tab) => tabOwner(tree, tab) === id), 'Window closed')
    } catch (reason) { fail(reason) }
    finally { pending.current = false }
  }, [clearError, fail, reportRemoval])

  const resize = useCallback((id: string, ratio: number, phase: SplitResizePhase = 'commit') => {
    if (phase === 'cancel') return
    setLayout((value) => ({ ...value, tree: resizeSplit(value.tree, id, ratio) }))
  }, [])
  // Ctrl+W acts on what the selected tile shows: a view in front closes before the chat behind it.
  const focusedCloseTarget = useCallback((): string => {
    const owner = tabOwner(current.current.tree, selected.current)
    return owner && isViewTabId(owner) ? owner : selected.current
  }, [])
  const closeFocused = useCallback(async (): Promise<void> => {
    const tree = current.current.tree
    const owner = tabOwner(tree, selected.current)
    const id = focusedCloseTarget()
    const action = focusedCloseAction(tree, id)
    if (action === 'close-tab') await closeTab(id)
    else if (action === 'hide-pane' && owner) await hide(owner)
  }, [closeTab, hide, focusedCloseTarget])
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
    } else if (command.type === 'absorbCrossDock') {
      const size = crossWindowDockCanvasSize()
      setLayout((value) => ({
        ...value,
        tree: absorbCrossDockAtPointer(value.tree, value.browserVisible, command.paneId, command.tabIds, command.pointer, size, crypto.randomUUID())
      }))
      const focus = command.tabIds[0]
      if (focus) selected.current = focus
    } else if (command.type === 'removeCrossDockSource') {
      setLayout((value) => {
        let tree = value.tree
        for (const tab of command.tabIds) tree = removeTab(tree, tab) ?? tree
        if (!paneIds(tree).length) void window.closedai.window.close()
        return { ...value, tree }
      })
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
    // Focus comes from main's window list: a renderer's own hasFocus() can be true behind another window.
    if (isFrontWindow()) claimSelection()
    window.addEventListener('focus', claimSelection)
    return () => window.removeEventListener('focus', claimSelection)
  }, [])

  // Window moves are the tree alone: the chats they carry stay open, so none of them crosses IPC.
  const windowTree = useCallback((change: (tree: ChatLayout) => ChatLayout): void => {
    if (pending.current) return
    setLayout((value) => {
      const tree = change(value.tree)
      return tree === value.tree ? value : { ...value, tree }
    })
  }, [])
  const windowActions = useMemo(() => ({
    change: windowTree,
    /** Tile windows: every floating window back into its slot of the last tiled layout. */
    tileAll: () => windowTree(tileWindows),
    keepOnTop: (id: string, onTop: boolean) => windowTree((tree) => setWindowOnTop(tree, id, onTop)),
    group: (source: string, target: string) => windowTree((tree) => groupWindow(tree, source, target)),
    raise: (id: string) => windowTree((tree) => raiseWindow(tree, id)),
    minimize: (id: string) => {
      windowTree((tree) => minimizeWindow(tree, id))
      // The selection follows what is on screen, like hiding a pane.
      const remaining = chatPaneIds(minimizeWindow(current.current.tree, id))
      if (tabOwner(current.current.tree, selected.current) === id && remaining[0]) void focusPane(remaining[0])
    },
    restore: (id: string) => {
      windowTree((tree) => restoreWindow(tree, id))
      void focusPane(id)
    }
  }), [windowTree, focusPane])

  const setMaximized = useCallback((next: SetStateAction<string | null>): void => setLayout((value) => {
    const current = value.maximized ?? null
    const maximized = typeof next === 'function' ? next(current) : next
    return maximized === current ? value : { ...value, maximized: maximized ?? undefined }
  }), [])
  const toggleBrowser = useCallback(() => setLayout((value) => ({ ...value, browserVisible: !value.browserVisible })), [])
  // The quick chat is created unselected and reported visible before main could discard it as blank,
  // on the model the quick chat last used. A fresh one replaces it: the previous chat goes back to
  // history (or away, when blank).
  // A chat that is not a tab (the quick chat, a notepad window's chat): created unselected and
  // reported visible at once, before main could discard it as a blank unselected chat.
  const newSideChat = useCallback(async (modelId: string | null, quickChatSurface?: import('../../shared/quick-chat-overlay.js').QuickChatSurface): Promise<string> => {
    const anchor = chatPaneIds(current.current.tree).includes(selected.current) ? selected.current : undefined
    const id = await window.closedai.chat.newPeer(anchor, {
      select: false,
      ...(modelId ? { modelId } : {}),
      ...(quickChatSurface ? { quickChatSurface } : {})
    })
    const visible = [...chatPaneIds(current.current.tree), ...sideChats(current.current), id]
    await window.closedai.chat.setVisiblePanes(cwd, [...new Set(visible)], chatTabIds(current.current.tree))
    return id
  }, [cwd])
  const openBrowserChat = useCallback(async (fresh = false): Promise<void> => {
    const previous = current.current.browserChat
    const available = latestSnapshot.current().chats.some((chat) => chat.paneId === previous)
    if (previous && available && !fresh) {
      setLayout((value) => ({ ...value, browserChatOpen: true }))
      return
    }
    if (pending.current) return
    pending.current = true
    try {
      const id = await newSideChat(readQuickChatModel(window.localStorage), 'browser')
      setLayout((value) => ({ ...value, browserChat: id, browserChatOpen: true }))
      if (previous && available) await window.closedai.chat.closePeer(previous)
    } catch (reason) {
      fail(reason)
    } finally {
      pending.current = false
    }
  }, [fail, newSideChat])
  const setBrowserChatOpen = useCallback((open: boolean) => setLayout((value) => ({ ...value, browserChatOpen: open })), [])
  const showBrowser = useCallback(() => setLayout((value) => value.browserVisible ? value : { ...value, browserVisible: true }), [])
  return {
    ...layout, browserVisible: self.main && layout.browserVisible, detached: !self.main,
    error: error?.text ?? '', notice: notice?.text ?? '', busy, dock, newChat, newChatWindow, openWindow, setCanvasSize, continueChat, focusPane,
    activateTab, openView, toggleView, pinView, moveTabToTile, closeTab, hide, closeFocused, focusedCloseTarget, resize, arrange,
    toggleBrowser, showBrowser, detachTab, returnTab, windows: windowActions,
    maximized: layout.maximized ?? null, setMaximized,
    browserChat, browserChatOpen: Boolean(browserChat && layout.browserChatOpen), openBrowserChat, setBrowserChatOpen, newSideChat
  }
}

/** A tab another window holds is brought forward there instead of being opened twice. */
async function revealedElsewhere(tree: ChatLayout, id: string): Promise<boolean> {
  if (tabIds(tree).includes(id) || !tabsHeldElsewhere().has(id)) return false
  return window.closedai.windows.revealTab(id)
}

/** The chat's tile shows another chat in front of it, rather than a view or a minimized window. */
function behindSiblingChat(tree: ChatLayout, id: string): boolean {
  if (isChatTabActive(tree, id)) return false
  const owner = tabOwner(tree, id)
  return owner !== null && !isViewTabId(owner) && !minimizedTile(tree, owner)
}

function minimizedTile(tree: ChatLayout, id: string): boolean {
  return tree.kind === 'pane' ? tree.id === id && Boolean(tree.docked) : minimizedTile(tree.first, id) || minimizedTile(tree.second, id)
}

function withoutTab(tree: ChatLayout, id: string): ChatLayout {
  const removed = removeTab(tree, id)
  const next = removed ? ensureExpandedGroup(removed) : removed
  return next && paneIds(next).length ? next : tree
}
