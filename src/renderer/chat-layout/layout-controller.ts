import { appendSideChat, findSidebarStack, migrateSidebarStack, swapSidebarLead } from './sidebar-stack.js'
import { ensureExpandedGroup, layoutGroups } from './layout-docking.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import { errorMessage } from '../error-message.js'
import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, chatPaneIds, isViewTabId, withBrowser, dockBrowser, dockPane, paneIds, readLayout, removePane, resizeSplit, saveLayout, type ChatLayout, type DockEdge, type SplitResizePhase } from './layout-tree.js'
import { storedSplitRatio } from './layout-split-resize.js'
import { addTab, chatTabIds, focusChatTabInLayout, focusedCloseAction, isChatTabActive, moveTab, neighborTile, pruneTabs, removeTab, selectTab, tabIds, tabOwner, type TileDirection } from './layout-tabs.js'
import { isSingletonViewKind, openTabInTree, pinOnMove, pruneViewScopes, sameTabKind, viewOfKind, viewScope, viewTabId, type ViewKind } from './layout-views.js'
import { notepadChats, pruneNotepadChats } from '../notepad/notepad-layout.js'
import { adoptTabs, dismissWindow, initialWindowTree } from './layout-windows.js'
import { adoptsUnheldChats, appWindow, isFrontWindow, onAppWindowCommand, tabsHeldElsewhere, useAppWindows } from '../app-windows/app-window-store.js'
import { tabInNewWindow, floatBeside, groupWindow, minimizeWindow, raiseWindow, restoreWindow } from './floating/window-layout.js'
import { setWindowOnTop, tileWindows } from './floating/window-arrange.js'
import { absorbCrossDockAtPointer } from './floating/cross-window-dock-target.js'
import { crossWindowDockCanvasSize } from '../app-windows/cross-window-dock-store.js'
import { assignExpandedGroups, assignGroups, fitDeskSignature, fitLayoutVariants, presetLayout, presetSlots, rotateGroupsToFront, sidebarStackForLead, singleGroup, type CanvasSize, type LayoutPreset } from './layout-presets.js'
import { canPromoteStackMonitorLead } from './stack-monitor-layout.js'
import { autoPlace, type WindowOpen } from './auto-place.js'
import { adoptContinuedChat, separateChatCards } from './chat-cards.js'
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
  spaceId?: string,
  /** A chat tab the user closed or a pane they hid — not detach-to-new-window. */
  onChatTabClosed?: (chatId: string) => void
) {
  const snapshot = getSnapshot()
  const cwd = snapshot.workspace?.cwd ?? snapshot.selected.cwd
  // A detached window keeps its own saved layout and never hosts the browser.
  const self = appWindow()
  const layoutKey = self.main && spaceId ? spaceId : cwd
  const windows = useAppWindows()
  const [restored] = useState(() => readLayout(window.localStorage, layoutKey, self.id))
  const [layout, commitLayout] = useState(() => {
    const { focused: _focused, ...saved } = restored
    const tree = initialWindowTree(saved.tree, {
      available: new Set(snapshot.chats.map((chat) => chat.paneId)), elsewhere: tabsHeldElsewhere(),
      selectedPaneId: snapshot.selectedPaneId, detached: !self.main, initialTabs: self.initialTabs,
      fallbackView: () => viewTabId('history', crypto.randomUUID())
    })
    return { ...saved, tree: migrateSidebarStack(separateChatCards(withBrowser(tree))) }
  })
  // Normalize every entry path: restore, new chat, handoff, presets, and cross-window adoption.
  const setLayout = useCallback((update: SetStateAction<typeof layout>) => {
    commitLayout((previous) => {
      const next = typeof update === 'function' ? update(previous) : update
      const tree = separateChatCards(next.tree)
      return tree === next.tree ? next : { ...next, tree }
    })
  }, [])
  // Objects rather than strings: repeating the same message restarts its dismissal timer.
  const [error, setError] = useState<{ text: string } | null>(null)
  const latestSnapshot = useRef(getSnapshot)
  latestSnapshot.current = getSnapshot
  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), ERROR_TTL_MS)
    return () => window.clearTimeout(timer)
  }, [error])
  const fail = useCallback((reason: unknown) => setError({ text: errorMessage(reason) }), [])
  const clearError = useCallback(() => setError(null), [])
  const [busy, setBusy] = useState(false)
  const [selectionToConfirm, setSelectionToConfirm] = useState<string | null>(null)
  const pending = useRef(false)
  // This window's own selection: a chat another window selects is never recorded here. Main's
  // selection names the window in front; every other window resumes the chat it last had focused.
  const selected = useRef(chatTabIds(layout.tree).includes(snapshot.selectedPaneId) ? snapshot.selectedPaneId
    : restored.focused && chatPaneIds(layout.tree).includes(restored.focused) ? restored.focused
      : chatPaneIds(layout.tree)[0] ?? snapshot.selectedPaneId)
  // The chat whose last window the user closed: main still selects it, but it stays out of the
  // layout until something (History, a new chat) asks for a chat again.
  const closedLast = useRef<string | null>(null)
  /** Chats the user dismissed with window close; do not re-open while main selection catches up. */
  const heldOutOfLayout = useRef<Set<string>>(new Set(restored.tree && !chatTabIds(layout.tree).includes(snapshot.selectedPaneId)
    ? [snapshot.selectedPaneId] : []))
  const current = useRef(layout)
  current.current = layout
  // Main hears about chats only: a tile showing a view has no visible chat, its chats are retained.
  // Each notepad window's chat is visible too, so main keeps it attached and streaming.
  const sideChats = (value: typeof layout): string[] => notepadChats(value.tree)
  const idsKey = JSON.stringify([...new Set([...chatPaneIds(layout.tree), ...notepadChats(layout.tree)])])
  const tabsKey = JSON.stringify(chatTabIds(layout.tree))
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
    let active = true
    void window.closedai.chat.setVisiblePanes(cwd, JSON.parse(idsKey) as string[], JSON.parse(tabsKey) as string[]).catch((reason: unknown) => {
      if (active) fail(reason)
    })
    return () => { active = false }
  }, [cwd, idsKey, tabsKey, fail])

  const chatIdsKey = useMemo(() => {
    const ids = getSnapshot().chats.map((chat) => chat.paneId)
    ids.sort()
    return ids.join('\0')
  }, [layoutRevision])

  // Drop archived or removed chats from the saved tree without touching tab focus.
  useEffect(() => {
    const available = new Set(chatIdsKey.split('\0').filter(Boolean))
    setLayout((value) => {
      const tree = pruneNotepadChats(pruneTabs(value.tree, available), available)
      if (tree === value.tree) return value
      return { ...value, tree: tree! }
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
    // Opening Notes or another view does not request the closed chat back. Only an explicit
    // activation (which clears closedLast) or a different main selection does that.
    if (next === closedLast.current || heldOutOfLayout.current.has(next)) return
    closedLast.current = null
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
      else if (!tabIds(tree).includes(next)) tree = openTabInTree(tree, next, previous, crypto.randomUUID())
      else if (!isChatTabActive(tree, next)) tree = focusChatTabInLayout(tree, next)
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
          : appendSideChat(tree, added, () => crypto.randomUUID()) ?? addTab(tree, target, added) }
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
  /** Double-click layout cycle for the current expanded desk. */
  const fitCycleKey = useRef<string | null>(null)
  const fitCycleIndex = useRef(0)
  const lastFitTree = useRef<ChatLayout | null>(null)
  /** Set after `fitVisibleWindows` is defined; history/search opens refit through this. */
  const fitVisibleWindowsRef = useRef<(focusId: string) => void>(() => {})
  const clearFitCycle = useCallback((): void => {
    fitCycleKey.current = null
    fitCycleIndex.current = 0
    lastFitTree.current = null
  }, [])
  /**
   * Open a new window (a dock chat, the notepad). `change` gets `tile`, which halves the roomiest
   * tile for `id` and returns null when none can be halved, so the caller floats it instead. A
   * changed window ends any maximized one, or the opened window would remain hidden behind it.
   */
  const openWindowIn = (value: typeof layout, change: WindowOpen): typeof layout => {
    const tile = (tree: ChatLayout, id: string): ChatLayout | null => {
      const next = autoPlace(tree, id, { ...canvasSize.current, browserVisible: self.main && value.browserVisible },
        crypto.randomUUID(), tabOwner(tree, selected.current))
      return next
    }
    const tree = change(value.tree, tile)
    if (tree === value.tree) return value
    if (!value.maximized) return { ...value, tree }
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
    const chats = chatTabIds(current.current.tree)
    const host = chats.includes(selected.current) ? selected.current : chats[0]
    pending.current = true
    setBusy(true)
    clearError()
    try {
      const added = await window.closedai.chat.newPeer(host)
      selected.current = added
      setLayout((value) => openWindowIn(value, (tree, tile) => tile(tree, added)
        ?? tabInNewWindow(tree, added, host, crypto.randomUUID())))
      setSelectionToConfirm(added)
    } catch (reason) {
      fail(reason)
      release()
    }
  }, [clearError, fail, release])

  // "Continue in new chat" and "Clear chat": the created chat (digest-seeded or blank) replaces the
  // source in the layout (same card or tile); the old conversation stays in history, dismissed like a
  // closed card. Main's refusal (for example a turn still running) surfaces through the same error
  // line as any other layout op.
  const replaceChatCard = useCallback(async (sourceId: string, create: () => Promise<string>): Promise<void> => {
    if (pending.current) return
    const treeBefore = current.current.tree
    const owner = tabOwner(treeBefore, sourceId) ?? sourceId
    pending.current = true
    setBusy(true)
    clearError()
    try {
      const added = await create()
      selected.current = added
      onChatTabClosed?.(sourceId)
      setLayout((value) => {
        const replaced = adoptContinuedChat(value.tree, sourceId, added)
        const tree = ensureExpandedGroup(replaced) ?? replaced
        const solo = value.maximized
        const maximized = solo === owner || solo === sourceId ? added : solo
        return tree === value.tree && maximized === value.maximized ? value : { ...value, tree, maximized: maximized ?? undefined }
      })
      setSelectionToConfirm(added)
    } catch (reason) {
      fail(reason)
      release()
    }
  }, [clearError, fail, onChatTabClosed, release])
  const continueChat = useCallback((sourceId: string, threadId: string | null, modelId: string | null): Promise<void> =>
    replaceChatCard(sourceId, () => window.closedai.chat.continueInNewPeer({ paneId: sourceId, threadId }, modelId)),
  [replaceChatCard])
  /** A blank chat in the same card, keeping the source's folder, model and effort. */
  const clearChat = useCallback((sourceId: string): Promise<void> =>
    replaceChatCard(sourceId, () => window.closedai.chat.newPeer(sourceId)),
  [replaceChatCard])

  /** Show a tab. A chat already open is focused; with `anchor`, a new one joins that tile; without
   * `anchor` (header search, history) it opens in its own window, then visible windows refit to the
   * canvas like a header double-click fit. Views focus their tile. */
  const activateTab = useCallback(async (id: string, anchor?: string): Promise<void> => {
    if (pending.current || await revealedElsewhere(current.current.tree, id)) return
    // Another action may have started while the other-window lookup was in flight.
    if (pending.current) return
    pending.current = true
    setBusy(true)
    const alreadyOnDesk = tabIds(current.current.tree).includes(id)
    const view = isViewTabId(id)
    if (!view) selected.current = id
    closedLast.current = null
    heldOutOfLayout.current.delete(id)
    const focusTab = (): void => {
      setLayout((value) => {
        if (!paneIds(value.tree).length) return { ...value, tree: withBrowser({ kind: 'pane', id }) }
        return { ...value, tree: openTabInTree(value.tree, id, anchor ?? null, crypto.randomUUID()) }
      })
    }
    const showChat = (): void => {
      setLayout((value) => {
        if (!paneIds(value.tree).length) return { ...value, tree: withBrowser({ kind: 'pane', id }) }
        const tree = value.tree
        if (tabIds(tree).includes(id)) {
          return { ...value, tree: openTabInTree(tree, id, anchor ?? null, crypto.randomUUID()) }
        }
        if (anchor) {
          return { ...value, tree: openTabInTree(tree, id, anchor, crypto.randomUUID()) }
        }
        const chats = chatTabIds(tree)
        const near = chats.includes(selected.current) ? selected.current : chats[0]
        return openWindowIn(value, (next, tile) => openTabInTree(next, id, near ?? null, crypto.randomUUID(), true, tile))
      })
    }
    try {
      if (view) {
        focusTab()
        await selectViewChat(id)
        release()
      } else {
        // Load the saved transcript before the tab panel unhides so the pane does not flash empty
        // and jump when cached messages land.
        await window.closedai.chat.openChat(id)
        showChat()
        if (!anchor && !alreadyOnDesk && !findSidebarStack(current.current.tree)) fitVisibleWindowsRef.current(id)
        setSelectionToConfirm(id)
      }
      clearError()
    } catch (reason) {
      fail(reason)
      release()
    }
  }, [clearError, fail, release, selectViewChat])

  /**
   * Open a view in a window of its own kind, never beside chats: an open one is focused, a file
   * (`key`) joins a file window, anything else gets a new window placed near `near`.
   * No IPC: views are renderer state.
   */
  const openView = useCallback((kind: ViewKind, near: string, key?: string): void => {
    if (pending.current) return
    const tree = current.current.tree
    const id = key ? viewTabId(kind, key) : isSingletonViewKind(kind) && viewOfKind(tree, kind) || viewTabId(kind, crypto.randomUUID())
    if (!paneIds(tree).length) {
      setLayout((value) => ({ ...value, tree: withBrowser({ kind: 'pane', id }) }))
      return
    }
    if (tabIds(tree).includes(id)) { void activateTab(id); return }
    openWindow((value, tile) => openTabInTree(value, id, near, crypto.randomUUID(), false, tile))
  }, [activateTab, openWindow])

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
      if (!target || !sameTabKind(id, target)) return value
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
    if (!isViewTabId(id)) heldOutOfLayout.current.add(id)
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
      if (!isViewTabId(id)) onChatTabClosed?.(id)
    } catch (reason) {
      heldOutOfLayout.current.delete(id)
      fail(reason)
      release()
    }
  }, [clearError, fail, onChatTabClosed, release])

  const hide = useCallback(async (id: string): Promise<void> => {
    const tree = current.current.tree
    const paneId = tabOwner(tree, id) ?? id
    const remaining = removePane(tree, paneId)
    if (!remaining || pending.current || !tabOwner(tree, id)) return
    const dismissed = tabIds(tree).filter((tab) => tabOwner(tree, tab) === paneId && !isViewTabId(tab))
    for (const chatId of dismissed) heldOutOfLayout.current.add(chatId)
    const closesSelection = tabOwner(tree, selected.current) === paneId
    const nextChat = closesSelection ? chatPaneIds(remaining)[0] : undefined
    // A view id is never a chat-service selection. With no remaining visible chat, retain the
    // backend selection but suppress its automatic adoption, even when Notes remains open.
    if (closesSelection && !nextChat) {
      closedLast.current = selected.current
      if (!isViewTabId(selected.current)) heldOutOfLayout.current.add(selected.current)
    }
    pending.current = true
    setBusy(true)
    try {
      if (nextChat) {
        await window.closedai.chat.selectPane(nextChat)
        selected.current = nextChat
      }
      setLayout((value) => dismissWindow(value, paneId))
      for (const chatId of dismissed) onChatTabClosed?.(chatId)
      clearError()
    } catch (reason) {
      for (const chatId of dismissed) heldOutOfLayout.current.delete(chatId)
      if (closedLast.current === selected.current) closedLast.current = null
      fail(reason)
    } finally { release() }
  }, [clearError, fail, onChatTabClosed, release])

  const resize = useCallback((id: string, ratio: number, phase: SplitResizePhase = 'commit') => {
    if (phase === 'cancel') return
    if (phase === 'commit') clearFitCycle()
    setLayout((value) => ({ ...value,
      tree: resizeSplit(value.tree, id, storedSplitRatio(value.tree, id, ratio, self.main && value.browserVisible)) }))
  }, [clearFitCycle])
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
    if (!isViewTabId(id) && owner) await hide(owner)
    else if (action === 'close-tab') await closeTab(id)
    else if (action === 'hide-pane' && owner) await hide(owner)
  }, [closeTab, hide, focusedCloseTarget])
  /** Title-bar toggle: close the view of this kind when it is in front of its window, else open it. */
  const toggleView = useCallback(async (kind: ViewKind): Promise<void> => {
    const tree = current.current.tree
    const existing = viewOfKind(tree, kind)
    if (existing && paneIds(tree).includes(existing)) await closeTab(existing)
    else openView(kind, selected.current)
  }, [closeTab, openView])
  // A preset is a starting arrangement: open tiles keep their tab groups, missing slots get new
  // chats, and the result is saved like any hand-built tree, so every drag and resize still applies.
  const arrange = useCallback(async (preset: LayoutPreset, size: CanvasSize): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    clearError()
    clearFitCycle()
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
  }, [cwd, clearError, clearFitCycle, fail, release])
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
      if (tree === value.tree) return value
      clearFitCycle()
      return { ...value, tree }
    })
  }, [clearFitCycle])
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
  const fitVisibleWindows = useCallback((focusId: string): void => {
    const size = canvasSize.current
    if (size.width <= 0 || size.height <= 0) return
    setLayout((value) => {
      const tiled = tileWindows(value.tree)
      const groups = rotateGroupsToFront(assignExpandedGroups(tiled), focusId)
      const browserOnly = groups.length === 0 && focusId === BROWSER_PANE_ID && self.main && value.browserVisible
      if (groups.length <= 1) {
        clearFitCycle()
        if (groups.length === 0 && !browserOnly) return { ...value, tree: tiled }
        const target = focusId === BROWSER_PANE_ID ? BROWSER_PANE_ID : (tabOwner(tiled, focusId) ?? groups[0]?.active ?? focusId)
        const solo = value.maximized === target
          || (value.maximized !== undefined && groups[0]?.tabs.includes(value.maximized))
        if (solo) return { ...value, tree: tiled, maximized: undefined }
        return { ...value, tree: tiled, maximized: target }
      }
      const browserVisible = self.main && value.browserVisible
      const variants = fitLayoutVariants(groups, size, browserVisible)
      if (!variants.length) return value
      const key = fitDeskSignature(groups, browserVisible)
      let index = 0
      if (key === fitCycleKey.current && value.tree === lastFitTree.current) {
        index = (fitCycleIndex.current + 1) % variants.length
      } else if (key !== fitCycleKey.current) {
        fitCycleKey.current = key
        index = 0
      }
      fitCycleIndex.current = index
      const fitted = variants[index]!(groups, size, () => crypto.randomUUID())
      const nextTree = withBrowser(fitted)
      lastFitTree.current = nextTree
      const { maximized: _cleared, ...rest } = value
      return { ...rest, tree: nextTree }
    })
  }, [clearFitCycle])
  fitVisibleWindowsRef.current = fitVisibleWindows
  const promoteSidebarLead = useCallback((focusId: string): void => {
    const size = canvasSize.current
    if (size.width <= 0 || size.height <= 0) return
    setLayout((value) => {
      const swapped = swapSidebarLead(value.tree, focusId)
      if (swapped) {
        clearFitCycle()
        return { ...value, tree: swapped, maximized: undefined }
      }
      const tiled = tileWindows(value.tree)
      const groups = assignExpandedGroups(tiled)
      const fitted = sidebarStackForLead(groups, size, focusId, () => crypto.randomUUID())
      if (!fitted) return value
      clearFitCycle()
      const nextTree = self.main && value.browserVisible && !layoutIdsIncludeBrowser(fitted)
        ? withBrowser(fitted)
        : fitted
      const { maximized: _cleared, ...rest } = value
      return { ...rest, tree: nextTree }
    })
    void focusPane(focusId)
  }, [clearFitCycle, focusPane])
  const stackMonitorLeadPromotable = useCallback((paneId: string): boolean => {
    if (findSidebarStack(current.current.tree)) return swapSidebarLead(current.current.tree, paneId) !== null
    const size = canvasSize.current
    const tiled = tileWindows(current.current.tree)
    const groups = assignExpandedGroups(tiled)
    return canPromoteStackMonitorLead(tiled, size, paneId, groups.length)
  }, [])
  const maybePromoteStackMonitorLead = useCallback((paneId: string): void => {
    if (!stackMonitorLeadPromotable(paneId)) return
    promoteSidebarLead(paneId)
  }, [promoteSidebarLead, stackMonitorLeadPromotable])
  // A notepad window's chat: created unselected and reported visible at once, before main could
  // discard it as a blank unselected chat.
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
  const showBrowser = useCallback(() => setLayout((value) => value.browserVisible ? value : { ...value, browserVisible: true }), [])
  return {
    ...layout, browserVisible: self.main && layout.browserVisible, detached: !self.main,
    error: error?.text ?? '', busy, dock, newChat, newChatWindow, openWindow, setCanvasSize, continueChat, clearChat, focusPane,
    activateTab, openView, toggleView, pinView, moveTabToTile, closeTab, hide, closeFocused, focusedCloseTarget, resize, arrange,
    toggleBrowser, showBrowser, fitVisibleWindows, stackMonitorLeadPromotable, maybePromoteStackMonitorLead, detachTab, returnTab, windows: windowActions,
    maximized: layout.maximized ?? null, setMaximized,
    newSideChat
  }
}

function layoutIdsIncludeBrowser(tree: ChatLayout): boolean {
  return tree.kind === 'pane' ? tree.id === BROWSER_PANE_ID
    : layoutIdsIncludeBrowser(tree.first) || layoutIdsIncludeBrowser(tree.second)
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
  const next = removeTab(tree, id)
  return next && paneIds(next).length ? next : tree
}
