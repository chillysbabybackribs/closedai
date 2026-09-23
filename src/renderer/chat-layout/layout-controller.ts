import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import { errorMessage } from '../error-message.js'
import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, withBrowser, dockBrowser, dockPane, paneIds, readLayout, removePane, resizeSplit, saveLayout, type ChatLayout, type DockEdge } from './layout-tree.js'
import { addTab, focusedCloseAction, moveTab, neighborTile, pruneTabs, removeTab, selectTab, tabIds, tabOwner, type TileDirection } from './layout-tabs.js'
import { removalNotice } from './layout-copy.js'
import { assignGroups, presetLayout, presetSlots, singleGroup, type CanvasSize, type LayoutPreset } from './layout-presets.js'
import { coordinatorBrowserSideLayout } from './layout-coordinator.js'

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
    else if (!paneIds(tree).includes(snapshot.selectedPaneId)) {
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
  const idsKey = JSON.stringify(paneIds(layout.tree))
  const tabsKey = JSON.stringify(tabIds(layout.tree))
  const release = useCallback(() => {
    pending.current = false
    setSelectionToConfirm(null)
    setBusy(false)
  }, [])

  useEffect(() => {
    saveLayout(window.localStorage, cwd, layout)
  }, [cwd, layout])

  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[]
    if (!ids.length || !ids[0]) return
    let active = true
    void window.closedai.chat.setVisiblePanes(cwd, ids, JSON.parse(tabsKey) as string[]).catch((reason: unknown) => {
      if (active) fail(reason)
    })
    return () => { active = false }
  }, [cwd, idsKey, tabsKey, fail])

  // History/search selection focuses an existing tab or adds one to the focused tile.
  // Split/add operations manage their own destination while main announces selection.
  useEffect(() => {
    // Workspace events are delivered in a React transition. An IPC reply can arrive
    // first; do not prune the new tab against the previous workspace snapshot.
    if (selectionToConfirm) {
      if (snapshot.selectedPaneId !== selectionToConfirm ||
          !snapshot.chats.some((chat) => chat.paneId === selectionToConfirm)) return
      release()
    } else if (pending.current) return
    const next = snapshot.selectedPaneId
    const previous = selected.current
    selected.current = next
    setLayout((value) => {
      let tree: ChatLayout | null = value.tree
      const available = new Set(snapshot.chats.map((chat) => chat.paneId))
      tree = pruneTabs(tree, available)
      if (!tree || !paneIds(tree).length) tree = withBrowser({ kind: 'pane', id: next })
      else if (!paneIds(tree).includes(next)) {
        tree = selectTab(tree, paneIds(tree).includes(previous) ? previous : paneIds(tree)[0]!, next)
      }
      return tree === value.tree ? value : { ...value, tree: tree! }
    })
  }, [snapshot.selectedPaneId, snapshot.chats, busy, cwd, selectionToConfirm, release])

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

  const focusPane = useCallback(async (id: string): Promise<void> => {
    // Menu focus restoration must not select the departing pane mid-operation.
    if (pending.current) return
    try {
      await window.closedai.chat.selectPane(id)
      clearError()
    } catch (reason) { fail(reason) }
  }, [clearError, fail])

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
    pending.current = true
    setBusy(true)
    clearError()
    try {
      const treeBefore = current.current.tree
      const sourceOwner = id ? tabOwner(treeBefore, id) : null
      const sourceHasSiblings = sourceOwner && tabIds(treeBefore).some((tab) => tab !== id && tabOwner(treeBefore, tab) === sourceOwner)
      if (edge && paneIds(treeBefore).length >= 32 && (!id || !paneIds(treeBefore).includes(id) || (singleTab && sourceHasSiblings))) {
        throw new Error('The workspace already has 32 visible chats')
      }
      if (!id) await window.closedai.chat.selectPane(target)
      const added = id ? await window.closedai.chat.openChat(id) : create ? await create() : await window.closedai.chat.newPeer()
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
      setSelectionToConfirm(added)
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

  const activateTab = useCallback(async (id: string): Promise<void> => {
    if (pending.current) return
    selected.current = id
    setLayout((value) => ({ ...value, tree: selectTab(value.tree, paneIds(value.tree)[0]!, id) }))
    try {
      await window.closedai.chat.openChat(id)
      clearError()
    } catch (reason) {
      fail(reason)
    }
  }, [clearError, fail])

  // Keyboard counterpart to dragging a tab onto another tile's header: no IPC, the chat stays selected.
  const moveTabToTile = useCallback((id: string, direction: TileDirection): void => {
    if (pending.current) return
    setLayout((value) => {
      const target = neighborTile(value.tree, id, direction)
      return target ? { ...value, tree: moveTab(value.tree, id, target, null, crypto.randomUUID()) } : value
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
        // Open also reattaches a tab that was parked and trimmed in the background.
        await window.closedai.chat.openChat(next)
        selected.current = next
        setSelectionToConfirm(next)
      } else {
        release()
      }
      setLayout((value) => {
        const next = removeTab(value.tree, id)
        return next && paneIds(next).length ? { ...value, tree: next } : value
      })
      reportRemoval([id], 'Tab closed')
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
  const closeFocused = useCallback(async (): Promise<void> => {
    const id = selected.current
    const action = focusedCloseAction(current.current.tree, id)
    if (action === 'close-tab') await closeTab(id)
    else if (action === 'hide-pane') {
      const owner = tabOwner(current.current.tree, id)
      if (owner) await hide(owner)
    }
  }, [closeTab, hide])
  // A preset is a starting arrangement: open tiles keep their tab groups, missing slots get new
  // chats, and the result is saved like any hand-built tree, so every drag and resize still applies.
  const arrange = useCallback(async (preset: LayoutPreset, size: CanvasSize): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    clearError()
    try {
      const { groups, missing } = assignGroups(current.current.tree, presetSlots(preset))
      const visible = paneIds(current.current.tree)
      const retained = tabIds(current.current.tree)
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
  const openCoordinatorWorkspace = useCallback(async (): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    clearError()
    try {
      const result = await window.closedai.chat.openCoordinatorWorkspace()
      const visible = [result.coordinatorPaneId, result.workerPaneId]
      await window.closedai.chat.setVisiblePanes(cwd, visible, visible)
      setLayout((value) => ({
        ...value,
        browserVisible: true,
        tree: coordinatorBrowserSideLayout(result, () => crypto.randomUUID())
      }))
      selected.current = result.coordinatorPaneId
      await window.closedai.chat.selectPane(result.coordinatorPaneId)
      setNotice({ text: 'Coordinator workspace: dedicated Coordinator and Worker chats beside the browser.' })
      release()
    } catch (reason) {
      fail(reason)
      release()
    }
  }, [cwd, clearError, fail, release])
  const disableCoordinator = useCallback(async (paneId: string): Promise<void> => {
    try {
      await window.closedai.chat.disableCoordinator(paneId)
      setNotice({ text: 'Coordinator mode cleared for this group.' })
      clearError()
    } catch (reason) { fail(reason) }
  }, [clearError, fail])
  const moveTabToTileGuarded = useCallback((id: string, direction: TileDirection): void => {
    const row = latestSnapshot.current.chats.find((chat) => chat.paneId === id)
    if (row?.coordinatorGroup) return
    moveTabToTile(id, direction)
  }, [moveTabToTile])
  return {
    ...layout, error: error?.text ?? '', notice: notice?.text ?? '', busy, dock, newChat, continueChat, focusPane,
    activateTab, moveTabToTile: moveTabToTileGuarded, closeTab, hide, closeFocused, resize, arrange, toggleBrowser,
    showBrowser, openCoordinatorWorkspace, disableCoordinator
  }
}
