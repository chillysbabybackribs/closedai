import { expandedPaneIds } from './layout-docking.js'
import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import type { WorkspaceBackdrop } from '../../shared/backdrop-presets.js'
import { useWorkspaceBackdropContextMenu } from '../backdrop/workspace-backdrop-menu.js'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { BROWSER_PANE_ID, CHAT_DRAG_TYPE, isViewTabId, layoutGeometry, removePane, type ChatLayout, type DockEdge, type Rect, type SplitResizePhase } from './layout-tree.js'
import { LayoutDivider } from './layout-divider.js'
import { createSplitResizeSession, paintSplitResize, type SplitResizeFrame } from './layout-split-resize.js'
import { CHAT_TAB_DRAG_TYPE } from './layout-tabs.js'
import type { TabActivity } from './tab-activity.js'
import { chatDropAt, dragPreviewPanes, dragSplitPreview } from './layout-drag-preview.js'
import { ChatLayoutPaneHeader } from './chat-layout-pane-header.js'
import { GLIDE_MS, miniature, useLayoutGlide } from './layout-motion.js'
import { WINDOW_HEADER, findWindow, floatWindow, minimizeWindow } from './floating/window-layout.js'
import { tearOffWindow, tileWindow } from './floating/window-arrange.js'
import { joinTabsTarget, snapTarget } from './floating/window-targets.js'
import { JoinTabsPreview } from './floating/join-tabs-preview.js'
import { browserCovered, canvasTiles, floatingFront } from './floating/window-tiles.js'
import { useWindowDrag, type WindowFrame } from './floating/use-window-drag.js'
import { useMaximizedWindow } from './floating/use-maximized-window.js'
import { BrowserWindowContext, WindowResizeHandles } from './floating/window-controls.js'
import { pressesMoveHandle } from './floating/window-move-handle.js'
import { TEAR_OFF_TARGET, useTabTearOff } from './floating/use-tab-tear-off.js'
import { CrossWindowDockPreview } from './cross-window-dock-preview.js'
import { DockClearanceContext } from '../dock/dock-clearance.js'
import { useReportDockSurface } from './use-report-dock-surface.js'

const position = (rect: Rect): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })
const contains = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
/** Holding the pointer in a placeholder this long, after its glide lands, shrinks the dragged tile into it. */
const HOLD_MS = GLIDE_MS + 90
/** The tile border; a tile body is its inner box. */
const TILE_BORDER = 1

/** Window operations the canvas asks of the layout; none of them crosses IPC. */
export type WindowActions = {
  /** Rearrange windows; a window move is the tree alone. */
  change: (update: (tree: ChatLayout) => ChatLayout) => void
  group: (source: string, target: string) => void
  raise: (id: string) => void
  minimize: (id: string) => void
  keepOnTop: (id: string, onTop: boolean) => void
}

/** React keys follow the first tab in a tile so adding a tab does not remount the header strip. */
function tileReactKey(activeId: string, tabs: string[]): string {
  return activeId === BROWSER_PANE_ID ? BROWSER_PANE_ID : tabs[0] ?? activeId
}

type ChatCanvasProps = {
  tree: ChatLayout
  selectedId: string
  busy: boolean
  notice?: string
  browserVisible: boolean
  browserRevealVersion?: number
  /** The maximized window, saved with the layout so a relaunch reopens it maximized. */
  maximized: [string | null, Dispatch<SetStateAction<string | null>>]
  renderBrowser: ReactNode
  onDragActive: (active: boolean) => void
  title: (id: string) => string
  activity?: (id: string) => TabActivity
  reviewQueue?: ChatReviewQueue
  chatRow?: (id: string) => ChatRowSummary | undefined
  renderPane: (id: string, visible: boolean) => ReactNode
  onSelect: (id: string) => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewChat: (id: string) => void
  /** The tools preset; the header names it while it is Read-only. */
  toolsPreset?: 'full' | 'read-only' | 'custom' | null
  onRenameChat?: (id: string) => void
  onTogglePin?: (id: string, pinned: boolean) => void
  /** Continue this conversation in a new tab of the same tile, seeded with its digest. */
  onContinueChat?: (id: string) => void
  onPauseTab?: (id: string) => void
  onResumeTab?: (id: string) => void
  onOpenPresets?: () => void
  /** Tile canvas content box, for arranging presets against the real space. */
  onSizeChange?: (size: { width: number; height: number }) => void
  onDock: (id: string | null, target: string, edge: DockEdge | null, singleTab?: boolean) => void | Promise<void>
  onHide: (id: string) => void
  onResize: (id: string, ratio: number, phase?: SplitResizePhase) => void
  windows: WindowActions
  /** A floating window above the browser overlaps it, so the page shows its still. */
  onBrowserCovered?: (covered: boolean) => void
  backdrop: WorkspaceBackdrop
  onBackdropChange: (mode: WorkspaceBackdrop) => void
  onOpenWallpaper: () => void
}

function ChatCanvasInner({ tree, selectedId, busy, notice, toolsPreset = null, browserVisible, browserRevealVersion, maximized, renderBrowser, onDragActive, title, activity, reviewQueue, chatRow, renderPane, onSelect, onSelectTab, onCloseTab, onNewChat, onRenameChat, onTogglePin, onContinueChat: _onContinueChat, onPauseTab, onResumeTab, onOpenPresets, onSizeChange, onDock, onHide, onResize, windows, onBrowserCovered, backdrop, onBackdropChange, onOpenWallpaper }: ChatCanvasProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const { openBackdropMenu, backdropMenu } = useWorkspaceBackdropContextMenu({ backdrop, onBackdropChange, onOpenWallpaper })
  const canvasRef = useRef<HTMLDivElement>(null)
  const layoutFrame = useRef<SplitResizeFrame>({ tree, browserVisible, width: 0, height: 0 })
  const splitResizeRef = useRef<ReturnType<typeof createSplitResizeSession> | null>(null)
  if (!splitResizeRef.current) {
    splitResizeRef.current = createSplitResizeSession(() => {
      const session = splitResizeRef.current
      if (!session) return
      paintSplitResize(canvasRef.current, session.live, layoutFrame.current)
    })
  }
  const splitResize = splitResizeRef.current
  const [size, setSize] = useState({ width: 0, height: 0 })
  const dockClear = useContext(DockClearanceContext)
  layoutFrame.current = { tree, browserVisible, width: size.width, height: size.height }
  useLayoutEffect(() => {
    if (!splitResize.live.active) return
    paintSplitResize(canvasRef.current, splitResize.live, layoutFrame.current)
  })
  const [dragging, setDragging] = useState<{ id: string; singleTab: boolean } | null>(null)
  const [drop, setDrop] = useState<{ target: string; edge: DockEdge | null } | null>(null)
  // Keep the accepted frame mounted while chat.openChat crosses IPC. Native dragend
  // ends the gesture, not the asynchronous layout transaction.
  const [settling, setSettling] = useState<ReturnType<typeof layoutGeometry> | null>(null)
  const settlingRef = useRef(false)
  const dragActiveListener = useRef(onDragActive)
  dragActiveListener.current = onDragActive
  const dropTarget = useRef<typeof drop>(null)
  const dropPaintRaf = useRef(0)
  // Armed from dragstart until the release glide lands, so the preview, the drop and a
  // cancelled drag's return all glide while the native browser view stays occluded.
  const glideArmed = useRef(false)
  const { whenIdle: whenGlideIdle, settle } = useLayoutGlide(canvasRef, () => glideArmed.current)
  // The dragged tile waits as an empty placeholder until the pointer holds inside it.
  const [held, setHeld] = useState(false)
  const holdTimer = useRef(0)
  const releaseHold = useCallback((): void => {
    window.clearTimeout(holdTimer.current)
    holdTimer.current = 0
    setHeld(false)
  }, [])
  const finishDrag = useCallback((): void => {
    releaseHold()
    if (dropPaintRaf.current) {
      cancelAnimationFrame(dropPaintRaf.current)
      dropPaintRaf.current = 0
    }
    dropTarget.current = null
    setDragging(null)
    setDrop(null)
  }, [releaseHold])
  const queueDrop = (next: typeof drop): void => {
    if (next?.target === dropTarget.current?.target && next?.edge === dropTarget.current?.edge) return
    dropTarget.current = next
    releaseHold()
    if (dropPaintRaf.current) return
    dropPaintRaf.current = requestAnimationFrame(() => {
      dropPaintRaf.current = 0
      setDrop(dropTarget.current)
    })
  }
  const tabFocus = useRef<string | null>(null)
  useEffect(() => {
    if (!tabFocus.current) return
    const tab = document.getElementById(`chat-tab-${tabFocus.current}`)
    if (tab?.getAttribute('aria-selected') === 'true') {
      tabFocus.current = null
      tab.focus()
    }
  }, [tree])
  const sizeListener = useRef(onSizeChange)
  sizeListener.current = onSizeChange
  useEffect(() => {
    const host = viewport.current!
    // Content box: the viewport's padding is the gutter around the tiles, not tile space.
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      const next = box ? { width: Math.floor(box.width), height: Math.floor(box.height) } : { width: host.clientWidth, height: host.clientHeight }
      setSize(next)
      sizeListener.current?.(next)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const start = (event: DragEvent): void => {
      if (settlingRef.current || !event.dataTransfer?.types.includes(CHAT_DRAG_TYPE)) return
      setDragging({ id: event.dataTransfer.getData(CHAT_DRAG_TYPE), singleTab: event.dataTransfer.types.includes(CHAT_TAB_DRAG_TYPE) })
      glideArmed.current = true
      dragActiveListener.current(true)
    }
    const clear = (): void => { finishDrag() }
    const cancel = (event: KeyboardEvent): void => { if (event.key === 'Escape') clear() }
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    window.addEventListener('blur', clear)
    window.addEventListener('keydown', cancel)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
      window.removeEventListener('blur', clear)
      window.removeEventListener('keydown', cancel)
      if (dropPaintRaf.current) cancelAnimationFrame(dropPaintRaf.current)
      window.clearTimeout(holdTimer.current)
      dragActiveListener.current(false)
    }
  }, [finishDrag])
  const visibleTree = browserVisible ? tree : removePane(tree, BROWSER_PANE_ID)!
  const geometry = layoutGeometry(visibleTree, size.width, size.height)
  const splitPreview = useMemo(() => (dragging && drop?.edge
    ? dragSplitPreview(tree, dragging.id, drop, dragging.singleTab, size.width, size.height, browserVisible)
    : null), [dragging, drop, tree, size.width, size.height, browserVisible])
  const preview = settling ?? splitPreview
  const minimum = preview?.minimum ?? geometry.minimum
  // Render the complete proposed layout: splitting the active tab also creates a
  // tile for its remaining siblings. Geometry alone cannot make that tile visible.
  const displayedTiles = dragPreviewPanes(geometry.panes, preview)
  const tiles = canvasTiles(tree, displayedTiles, size, browserVisible)
  const floating = floatingFront(tiles)
  const floatingIds = new Set(floating.map((tile) => tile.id))
  const layoutDividers = preview?.dividers ?? geometry.dividers
  // A live split preview turns the dragged tile into a placeholder at its destination.
  const holds = (tabs: string[]): boolean => Boolean(dragging && tabs.includes(dragging.id))
  const placeholder = splitPreview && !settling ? displayedTiles.find(({ tabs }) => holds(tabs)) ?? null : null
  const source = placeholder ? geometry.panes.find(({ id, tabs }) => holds([id, ...tabs]))?.rect ?? null : null
  const inner = (rect: Rect) => ({ width: Math.max(1, rect.width - 2 * TILE_BORDER), height: Math.max(1, rect.height - 2 * TILE_BORDER) })
  const mini = placeholder && source ? miniature(inner(placeholder.rect), inner(source)) : null
  const chatCount = expandedPaneIds(tree).length
  const canMaximize = chatCount > 1 || (browserVisible && chatCount >= 1)
  const shown = tiles.filter((tile) => tile.kind !== 'hidden')
  const [soloPaneId, setSoloPaneId] = useMaximizedWindow(shown, canMaximize || floating.length > 0, browserRevealVersion, maximized)
  const soloTile = soloPaneId ? shown.find((p) => p.id === soloPaneId || p.tabs.includes(soloPaneId)) ?? null : null
  const soloRect: Rect = { x: 0, y: 0, width: Math.max(size.width, minimum.width), height: Math.max(size.height, minimum.height) }
  const covered = !soloTile && browserCovered(tiles)
  const coveredListener = useRef(onBrowserCovered)
  coveredListener.current = onBrowserCovered
  useEffect(() => { coveredListener.current?.(covered) }, [covered])

  const frame = useRef<() => WindowFrame>(() => ({ tree, size, browserVisible, tiled: [], floating: [] }))
  frame.current = () => ({ tree, size, browserVisible, tiled: tiles.filter((tile) => tile.kind === 'tiled'), floating })
  const windowFrame = useCallback(() => frame.current(), [])
  // A window torn out of the tiled layer leaves the others where they are on screen, floating.
  const floatAt = useCallback((id: string, rect: Rect, tornOff: boolean) => {
    const { tiled } = frame.current()
    windows.change((tree) => tornOff ? tearOffWindow(tree, id, rect, tiled) : floatWindow(tree, id, rect))
  }, [windows])
  const snapAt = useCallback((id: string, target: Parameters<typeof snapTarget>[2]) => {
    const { size, tiled, floating } = frame.current()
    windows.change((tree) => snapTarget(tree, id, target, size, tiled, floating, crypto.randomUUID()))
  }, [windows])
  const dockSource = useCallback((id: string) => {
    const pane = findWindow(tree, id)
    const tabIds = pane?.tabs ?? [id]
    return { tabIds, ghostTabLabel: title(tabIds[0] ?? id) }
  }, [tree, title])
  useReportDockSurface(canvasRef)
  const { gesture, startMove, startResize } = useWindowDrag({
    canvas: canvasRef, frame: windowFrame, onPainted: settle,
    onActive: useCallback(() => {
      glideArmed.current = true
      dragActiveListener.current(true)
    }, []),
    onFloat: floatAt, onSnap: snapAt, onGroup: windows.group,
    onMaximize: useCallback((id: string) => setSoloPaneId(id), [setSoloPaneId]),
    dockSource
  })
  useEffect(() => {
    if (dragging || settling || gesture || !glideArmed.current) return
    let cancelled = false
    void whenGlideIdle().then(() => {
      if (cancelled) return
      glideArmed.current = false
      dragActiveListener.current(false)
    })
    return () => { cancelled = true }
  }, [dragging, settling, gesture, whenGlideIdle])

  const tearOff = useTabTearOff(windowFrame, windows.change)
  // Tab drops meet floating windows first: a floating chat's strip takes the tab into its tabs, and
  // free space, a floating window's body included, tears the tab off into its own window.
  const dropAt = (x: number, y: number) => {
    const hit = chatDropAt([...floating, ...geometry.panes], x, y, dropTarget.current)
    if (hit && !floatingIds.has(hit.target)) return hit
    const over = hit && hit.target !== BROWSER_PANE_ID ? floating.find((tile) => tile.id === hit.target) : undefined
    return over && y - over.rect.y < WINDOW_HEADER ? { target: over.id, edge: null } : tearOff.at(dragging, x, y)
  }
  const browserWindow = useMemo(() => ({
    maximized: soloTile?.id === BROWSER_PANE_ID,
    floating: floatingIds.has(BROWSER_PANE_ID),
    canMaximize: chatCount >= 1 || floatingIds.has(BROWSER_PANE_ID),
    toggleMaximize: () => setSoloPaneId((current) => current ? null : BROWSER_PANE_ID)
  }), [soloTile?.id, chatCount, floatingIds.has(BROWSER_PANE_ID), setSoloPaneId])

  // Preview movement can put a different DOM element under a stationary pointer.
  // Accept dragenter too, so release works before Chromium emits another dragover.
  const acceptDrag = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!dragging || !event.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return
    event.stopPropagation()
    if (busy) { event.dataTransfer.dropEffect = 'none'; return }
    event.preventDefault()
    if (soloTile) setSoloPaneId(null)
    const bounds = event.currentTarget.getBoundingClientRect()
    const next = dropAt(event.clientX - bounds.left, event.clientY - bounds.top)
    event.dataTransfer.dropEffect = next ? 'move' : 'none'
    if (next?.target !== dropTarget.current?.target || next?.edge !== dropTarget.current?.edge) {
      queueDrop(next)
      return
    }
    // Chromium repeats dragover while the pointer rests, so a stationary hold still arms.
    if (!placeholder || !contains(placeholder.rect, event.clientX - bounds.left, event.clientY - bounds.top)) {
      if (holdTimer.current || held) releaseHold()
    } else if (!held && !holdTimer.current) {
      holdTimer.current = window.setTimeout(() => { holdTimer.current = 0; setHeld(true) }, HOLD_MS)
    }
  }

  return <>
  <div className="chat-layout-viewport" ref={viewport} onContextMenu={openBackdropMenu}>
    <div className="chat-layout-canvas" ref={canvasRef} style={{ minWidth: minimum.width, minHeight: minimum.height }}
      onContextMenu={openBackdropMenu}
      // The shell's Escape handler leaves a drag in progress to the cancel listener above.
      data-layout-drag={dragging ? 'true' : undefined}
      data-layout-busy={busy ? 'true' : undefined}
      onDragEnterCapture={acceptDrag}
      onDragOverCapture={acceptDrag}
      onDragLeave={(event) => {
        if (!dragging) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX <= bounds.left || event.clientX >= bounds.right || event.clientY <= bounds.top || event.clientY >= bounds.bottom) {
          queueDrop(null)
        }
      }}
      onDropCapture={async (event) => {
        const source = event.dataTransfer.getData(CHAT_DRAG_TYPE)
        if (!source || settlingRef.current) return
        event.preventDefault()
        event.stopPropagation()
        const bounds = event.currentTarget.getBoundingClientRect()
        const target = dropAt(event.clientX - bounds.left, event.clientY - bounds.top)
        if (busy || !target) { finishDrag(); return }
        if (target.target === TEAR_OFF_TARGET) {
          finishDrag()
          if (tearOff.commit(source)) onSelect(source)
          return
        }
        const singleTab = event.dataTransfer.types.includes(CHAT_TAB_DRAG_TYPE)
        const accepted = dragSplitPreview(tree, source, target, singleTab, size.width, size.height, browserVisible)
        settlingRef.current = true
        setSettling(accepted)
        finishDrag()
        try {
          await onDock(source, target.target, target.edge, singleTab)
        } finally {
          settlingRef.current = false
          setSettling(null)
        }
      }}>
      {tiles.map(({ id: activeId, tabs, rect, kind, z }) => {
        const isThisTileSolo = soloTile ? (soloTile.id === activeId || soloTile.tabs.includes(activeId)) : false
        const tileRect = isThisTileSolo ? soloRect : rect
        const tileTabs = tabs
        const tileActiveId = tileTabs.includes(activeId) ? activeId : (tileTabs[0] ?? activeId)
        const row = chatRow?.(activeId)
        const isPlaceholder = placeholder?.id === activeId && mini !== null
        const floats = kind === 'floating' && !isThisTileSolo
        const browser = activeId === BROWSER_PANE_ID
        return <section key={tileReactKey(activeId, tileTabs)}
          className="chat-layout-tile" style={{ ...position(tileRect), zIndex: z && !isThisTileSolo ? 10 + z : undefined }}
          data-pane-id={browser || isViewTabId(activeId) ? undefined : activeId}
          data-view-id={isViewTabId(activeId) ? activeId : undefined}
          data-window={kind} data-moving={gesture?.id === activeId ? gesture.kind : undefined}
          data-solo={isThisTileSolo ? 'true' : undefined}
          data-drag-placeholder={isPlaceholder ? held ? 'mini' : 'empty' : undefined}
          hidden={soloTile ? !isThisTileSolo : kind === 'hidden'}
          data-selected={activeId === selectedId || tabs.includes(selectedId)} aria-label={browser ? 'Browser' : title(activeId)}
          onFocusCapture={(event) => { if (!browser && activeId !== selectedId && !(event.target as HTMLElement).closest('[role="tablist"]')) onSelect(activeId) }}
          onPointerDownCapture={(event) => {
            if (floats) windows.raise(activeId)
            if (!browser && activeId !== selectedId && !(event.target as HTMLElement).closest('[role="tablist"]')) onSelect(activeId)
          }}
          onPointerDown={(event) => { if (!busy && !soloTile && pressesMoveHandle(event)) startMove(event, activeId) }}
          onDoubleClick={browser ? (event) => {
            if (!pressesMoveHandle(event)) return
            if (floats) windows.change((current) => tileWindow(current, activeId))
            else browserWindow.toggleMaximize()
          } : undefined}>
          <div className="chat-layout-tile-body"
            style={isPlaceholder ? { ...position(mini.layout), '--mini-scale': mini.scale } as CSSProperties : undefined}>
            {!browser && <ChatLayoutPaneHeader activeId={tileActiveId} tabs={tileTabs} chatCount={chatCount}
              busy={busy} toolsPreset={toolsPreset ?? null} title={title} activity={activity} reviewQueue={reviewQueue}
              row={row} soloTile={soloTile ?? null} setSoloPaneId={setSoloPaneId} tabFocus={tabFocus} onSelect={onSelect}
              onSelectTab={onSelectTab} onCloseTab={onCloseTab} onNewChat={onNewChat} onRenameChat={onRenameChat}
              onTogglePin={onTogglePin} onPauseTab={onPauseTab} onResumeTab={onResumeTab} onOpenPresets={onOpenPresets}
              onHide={onHide} setDragging={setDragging} canMaximize={canMaximize || kind === 'floating'} isThisTileSolo={isThisTileSolo}
              canMinimize={minimizeWindow(tree, activeId) !== tree} onMinimize={windows.minimize}
              onTile={floats ? () => windows.change((current) => tileWindow(current, activeId)) : undefined}
              onTop={Boolean(findWindow(tree, activeId)?.onTop)} onKeepOnTop={windows.keepOnTop} />}
            {activeId === selectedId && <div className="chat-layout-notice" role="status" aria-atomic="true">{notice}</div>}
            {browser ? <div className="chat-layout-browser-frame" data-ui="layout.browser-dock">
              <BrowserWindowContext.Provider value={browserWindow}>{renderBrowser}</BrowserWindowContext.Provider>
            </div> : tileTabs.map((tabId) => <div key={tabId} className="chat-layout-content" role="tabpanel" id={`chat-panel-${tabId}`}
              aria-label={title(tabId)} hidden={tabId !== tileActiveId}>{renderPane(tabId, tabId === tileActiveId)}</div>)}
          </div>
          {floats && !busy && <WindowResizeHandles id={activeId} onStart={startResize} />}
        </section>
      })}
      {gesture?.preview && gesture.target.kind !== 'group' && <div className="chat-layout-snap-preview" data-kind={gesture.target.kind}
        style={position(gesture.preview)} aria-hidden="true" />}
      <JoinTabsPreview canvas={canvasRef} title={title} join={joinTabsTarget(shown, gesture, dragging && { id: dragging.id, drop })} />
      <CrossWindowDockPreview canvas={canvasRef} frame={windowFrame} browserVisible={browserVisible} title={title} />
      {drop?.target === TEAR_OFF_TARGET && tearOff.rect.current && <div ref={tearOff.outline} className="chat-layout-snap-preview"
        data-kind="tear-off" style={position(tearOff.rect.current)} aria-hidden="true" />}
      {!soloTile && layoutDividers.map((divider) => <LayoutDivider key={divider.id}
        divider={divider} splitResize={splitResize} onResize={onResize} />)}
    </div>
  </div>
  {backdropMenu}
  </>
}

function chatCanvasPropsEqual(previous: ChatCanvasProps, next: ChatCanvasProps): boolean {
  return previous.tree === next.tree && previous.selectedId === next.selectedId && previous.busy === next.busy
    && previous.notice === next.notice && previous.toolsPreset === next.toolsPreset
    && previous.browserVisible === next.browserVisible && previous.browserRevealVersion === next.browserRevealVersion
    && previous.maximized[0] === next.maximized[0] && previous.maximized[1] === next.maximized[1]
    && previous.renderBrowser === next.renderBrowser && previous.renderPane === next.renderPane
    && previous.onDragActive === next.onDragActive && previous.title === next.title && previous.activity === next.activity
    && previous.reviewQueue === next.reviewQueue && previous.chatRow === next.chatRow && previous.onSelect === next.onSelect
    && previous.onSelectTab === next.onSelectTab && previous.onCloseTab === next.onCloseTab && previous.onNewChat === next.onNewChat
    && previous.onRenameChat === next.onRenameChat && previous.onTogglePin === next.onTogglePin
    && previous.onPauseTab === next.onPauseTab && previous.onResumeTab === next.onResumeTab
    && previous.onOpenPresets === next.onOpenPresets && previous.onSizeChange === next.onSizeChange
    && previous.onDock === next.onDock && previous.onHide === next.onHide && previous.onResize === next.onResize
    && previous.windows === next.windows && previous.onBrowserCovered === next.onBrowserCovered
    && previous.backdrop === next.backdrop && previous.onBackdropChange === next.onBackdropChange
    && previous.onOpenWallpaper === next.onOpenWallpaper
}

export const ChatCanvas = memo(ChatCanvasInner, chatCanvasPropsEqual)
