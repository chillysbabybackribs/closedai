import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { BROWSER_PANE_ID, CHAT_DRAG_TYPE, WORKSPACE_DOCK_ID, isViewTabId, layoutGeometry, minimumSize, paneIds, removePane, type ChatLayout, type DockEdge, type Rect, type SplitResizePhase } from './layout-tree.js'
import type { ViewKind } from './layout-views.js'
import type { ViewHints } from './pane-add-menu.js'
import { LayoutDivider } from './layout-divider.js'
import { createSplitResizeSession, paintSplitResize, type SplitResizeFrame } from './layout-split-resize.js'
import { CHAT_TAB_DRAG_TYPE } from './layout-tabs.js'
import type { TabActivity } from './tab-activity.js'
import { browserDropAt, sameBrowserDrop, type BrowserDrop } from './browser-drop.js'
import { dragSplitPreview } from './layout-drag-preview.js'
import { applyLayoutGeometryDom } from './layout-geometry-dom.js'
import { ChatLayoutPaneHeader } from './chat-layout-pane-header.js'

const position = (rect: Rect): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })

type ChatCanvasProps = {
  tree: ChatLayout
  selectedId: string
  busy: boolean
  notice?: string
  browserVisible: boolean
  browserRevealVersion?: number
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
  /** Open (or focus) a view tab in a tile; absent, the + button only adds chats. */
  onOpenView?: (kind: ViewKind, tileId: string) => void
  /** The + menu's Browser row; reveals the shared browser. */
  onShowBrowser?: () => void
  viewHints?: ViewHints
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
  onDock: (id: string | null, target: string, edge: DockEdge | null, singleTab?: boolean) => void
  onHide: (id: string) => void
  onResize: (id: string, ratio: number, phase?: SplitResizePhase) => void
}

function ChatCanvasInner({ tree, selectedId, busy, notice, toolsPreset = null, browserVisible, browserRevealVersion, renderBrowser, onDragActive, title, activity, reviewQueue, chatRow, renderPane, onSelect, onSelectTab, onCloseTab, onNewChat, onOpenView, onShowBrowser, viewHints, onRenameChat, onTogglePin, onContinueChat: _onContinueChat, onPauseTab, onResumeTab, onOpenPresets, onSizeChange, onDock, onHide, onResize }: ChatCanvasProps) {
  const viewport = useRef<HTMLDivElement>(null)
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
  layoutFrame.current = { tree, browserVisible, width: size.width, height: size.height }
  useLayoutEffect(() => {
    if (!splitResize.live.active) return
    paintSplitResize(canvasRef.current, splitResize.live, layoutFrame.current)
  })
  const [dragging, setDragging] = useState<{ id: string; singleTab: boolean } | null>(null)
  const [drop, setDrop] = useState<{ target: string; edge: DockEdge | null } | null>(null)
  const dropTarget = useRef<typeof drop>(null)
  const dropPaintRaf = useRef(0)
  const queueDrop = (next: typeof drop): void => {
    if (next?.target === dropTarget.current?.target && next?.edge === dropTarget.current?.edge) return
    dropTarget.current = next
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
      if (!event.dataTransfer?.types.includes(CHAT_DRAG_TYPE)) return
      setDragging({ id: event.dataTransfer.getData(CHAT_DRAG_TYPE), singleTab: event.dataTransfer.types.includes(CHAT_TAB_DRAG_TYPE) })
      onDragActive(true)
    }
    const clear = (): void => {
      if (dropPaintRaf.current) {
        cancelAnimationFrame(dropPaintRaf.current)
        dropPaintRaf.current = 0
      }
      setDragging(null)
      setDrop(null)
      dropTarget.current = null
      onDragActive(false)
    }
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
      onDragActive(false)
    }
  }, [onDragActive])
  const [soloPaneId, setSoloPaneId] = useState<string | null>(null)
  useEffect(() => { setSoloPaneId(null) }, [browserRevealVersion])
  const visibleTree = browserVisible ? tree : removePane(tree, BROWSER_PANE_ID)!
  const geometry = layoutGeometry(visibleTree, size.width, size.height)
  const splitPreview = useMemo(() => (dragging && drop?.edge
    ? dragSplitPreview(tree, dragging.id, drop, dragging.singleTab, size.width, size.height)
    : null), [dragging, drop, tree, size.width, size.height])
  const minimum = splitPreview?.minimum ?? minimumSize(visibleTree)
  useLayoutEffect(() => {
    if (!splitPreview || !canvasRef.current) return
    applyLayoutGeometryDom(canvasRef.current, splitPreview)
  }, [splitPreview])
  const layoutPanes = splitPreview?.panes ?? geometry.panes
  // Keep the browser host mounted while hidden, just as inactive conversation tabs are.
  const tiles = browserVisible || layoutPanes.some((pane) => pane.id === BROWSER_PANE_ID)
    ? layoutPanes
    : [...layoutPanes, { id: BROWSER_PANE_ID, tabs: [BROWSER_PANE_ID], rect: { x: 0, y: 0, width: 0, height: 0 } }]
  const layoutDividers = splitPreview?.dividers ?? geometry.dividers
  const chatCount = paneIds(tree).length
  const canMaximize = chatCount > 1 || (browserVisible && chatCount >= 1)
  const soloTile = soloPaneId
    ? layoutPanes.find((p) => p.id === soloPaneId || p.tabs.includes(soloPaneId))
    : null

  useEffect(() => {
    if (!soloPaneId) return
    const exists = layoutPanes.some((p) => p.id === soloPaneId || p.tabs.includes(soloPaneId))
    if (!exists || (chatCount <= 1 && !browserVisible)) {
      setSoloPaneId(null)
    }
  }, [soloPaneId, layoutPanes, chatCount, browserVisible])

  useEffect(() => {
    if (!soloPaneId) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      event.preventDefault()
      setSoloPaneId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [soloPaneId])

  const soloRect: Rect = {
    x: 0,
    y: 0,
    width: Math.max(size.width, minimum.width),
    height: Math.max(size.height, minimum.height)
  }
  const browserDrop = drop?.edge && dragging?.id === BROWSER_PANE_ID ? drop as BrowserDrop : null
  const resolveBrowserDrop = (element: HTMLElement, x: number, y: number): BrowserDrop | null => {
    const bounds = element.getBoundingClientRect()
    return browserDropAt(geometry.panes, bounds.width, bounds.height, x - bounds.left, y - bounds.top,
      dropTarget.current?.edge ? dropTarget.current as BrowserDrop : null)
  }

  return <div className="chat-layout-viewport" ref={viewport}>
    <div className="chat-layout-canvas" ref={canvasRef} style={{ minWidth: minimum.width, minHeight: minimum.height }}
      // The shell's Escape handler leaves a drag in progress to the cancel listener above.
      data-layout-drag={dragging ? 'true' : undefined}
      onDragOverCapture={(event) => {
        if (dragging?.id !== BROWSER_PANE_ID) return
        event.stopPropagation()
        if (busy) { event.dataTransfer.dropEffect = 'none'; return }
        event.preventDefault()
        if (soloTile) setSoloPaneId(null)
        const next = resolveBrowserDrop(event.currentTarget, event.clientX, event.clientY)
        event.dataTransfer.dropEffect = next ? 'move' : 'none'
        if (sameBrowserDrop(browserDrop, next)) return
        queueDrop(next)
      }}
      onDragLeave={(event) => {
        if (dragging?.id !== BROWSER_PANE_ID) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX <= bounds.left || event.clientX >= bounds.right || event.clientY <= bounds.top || event.clientY >= bounds.bottom) {
          queueDrop(null)
        }
      }}
      onDropCapture={(event) => {
        if (event.dataTransfer.getData(CHAT_DRAG_TYPE) !== BROWSER_PANE_ID) return
        event.preventDefault()
        event.stopPropagation()
        const target = resolveBrowserDrop(event.currentTarget, event.clientX, event.clientY)
        if (!busy && dragging?.id === BROWSER_PANE_ID && target) onDock(BROWSER_PANE_ID, target.target, target.edge)
        dropTarget.current = null
        setDragging(null)
        setDrop(null)
        onDragActive(false)
      }}>
      {tiles.map(({ id: activeId, tabs, rect }) => {
        const isThisTileSolo = soloTile ? (soloTile.id === activeId || soloTile.tabs.includes(activeId)) : false
        const tileRect = isThisTileSolo ? soloRect : (splitPreview?.panes.find((pane) => pane.id === activeId)?.rect ?? rect)
        const tileKey = activeId === BROWSER_PANE_ID ? BROWSER_PANE_ID : (tabs[0] ?? activeId)
        const row = chatRow?.(activeId)
        return <section key={tileKey}
          className="chat-layout-tile" style={position(tileRect)} data-pane-id={activeId === BROWSER_PANE_ID || isViewTabId(activeId) ? undefined : activeId}
          data-view-id={isViewTabId(activeId) ? activeId : undefined}
          data-solo={isThisTileSolo ? 'true' : undefined}
          hidden={soloTile ? !isThisTileSolo : (activeId === BROWSER_PANE_ID && !browserVisible)}
          data-selected={activeId === selectedId || tabs.includes(selectedId)} aria-label={activeId === BROWSER_PANE_ID ? 'Browser' : title(activeId)}
          onFocusCapture={(event) => { if (activeId !== BROWSER_PANE_ID && activeId !== selectedId && !(event.target as HTMLElement).closest('[role="tablist"]')) onSelect(activeId) }}
          onPointerDownCapture={(event) => { if (activeId !== BROWSER_PANE_ID && activeId !== selectedId && !(event.target as HTMLElement).closest('[role="tablist"]')) onSelect(activeId) }}
          onDragOver={(event) => {
            if (busy || !event.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return
            if (soloTile) setSoloPaneId(null)
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const bounds = event.currentTarget.getBoundingClientRect()
            const x = (event.clientX - bounds.left) / bounds.width
            const y = (event.clientY - bounds.top) / bounds.height
            const edges: Array<[DockEdge, number]> = [['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]]
            const edge = activeId === BROWSER_PANE_ID ? (x < 0.5 ? 'left' : 'right')
              : dragging?.id !== BROWSER_PANE_ID && (event.target as HTMLElement).closest('.chat-layout-header') ? null
              : edges.sort((a, b) => a[1] - b[1])[0]![0]
            queueDrop({ target: activeId, edge })
          }}
          onDragLeave={(event) => {
            if (dragging?.id === BROWSER_PANE_ID) return
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) queueDrop(null)
          }}
          onDrop={(event) => {
            const source = event.dataTransfer.getData(CHAT_DRAG_TYPE)
            const target = dropTarget.current
            if (busy || !source || !target || target.target !== activeId) return
            event.preventDefault()
            event.stopPropagation()
            onDock(source, activeId, target.edge, event.dataTransfer.types.includes(CHAT_TAB_DRAG_TYPE))
            dropTarget.current = null
            setDragging(null)
            setDrop(null)
            onDragActive(false)
          }}>
          {activeId !== BROWSER_PANE_ID && <ChatLayoutPaneHeader activeId={activeId} tabs={tabs} chatCount={chatCount}
            busy={busy} toolsPreset={toolsPreset ?? null} title={title} activity={activity} reviewQueue={reviewQueue}
            row={row} soloTile={soloTile ?? null} setSoloPaneId={setSoloPaneId} tabFocus={tabFocus} onSelect={onSelect}
            onSelectTab={onSelectTab} onCloseTab={onCloseTab} onNewChat={onNewChat} onOpenView={onOpenView}
            onShowBrowser={onShowBrowser} viewHints={viewHints} browserVisible={browserVisible} onRenameChat={onRenameChat}
            onTogglePin={onTogglePin} onPauseTab={onPauseTab} onResumeTab={onResumeTab} onOpenPresets={onOpenPresets}
            onHide={onHide} setDragging={setDragging} canMaximize={canMaximize} isThisTileSolo={isThisTileSolo} />}
          {activeId === selectedId && <div className="chat-layout-notice" role="status" aria-atomic="true">{notice}</div>}
          {activeId === BROWSER_PANE_ID ? <div className="chat-layout-browser-frame" data-ui="layout.browser-dock">
            {renderBrowser}
          </div> : tabs.map((tabId) => <div key={tabId} className="chat-layout-content" role="tabpanel" id={`chat-panel-${tabId}`}
            aria-label={title(tabId)} hidden={tabId !== activeId}>{renderPane(tabId, tabId === activeId)}</div>)}
        </section>
      })}
      {dragging?.id === BROWSER_PANE_ID && !busy && (['left', 'right'] as const).map((edge) => <div key={edge}
        className="chat-layout-workspace-dock" data-edge={edge} data-ui="layout.workspace-dock" data-ui-key={edge}
        data-active={browserDrop?.target === WORKSPACE_DOCK_ID && browserDrop.edge === edge}
        aria-label={`Move browser to full-height ${edge} column`}
      ><span>Full-height column</span></div>)}
      {!soloTile && layoutDividers.map((divider) => <LayoutDivider key={divider.id}
        divider={divider} splitResize={splitResize} onResize={onResize} />)}
    </div>
  </div>
}

function chatCanvasPropsEqual(previous: ChatCanvasProps, next: ChatCanvasProps): boolean {
  return previous.tree === next.tree && previous.selectedId === next.selectedId && previous.busy === next.busy
    && previous.notice === next.notice && previous.toolsPreset === next.toolsPreset
    && previous.browserVisible === next.browserVisible && previous.browserRevealVersion === next.browserRevealVersion
    && previous.renderBrowser === next.renderBrowser && previous.renderPane === next.renderPane
    && previous.onDragActive === next.onDragActive && previous.title === next.title && previous.activity === next.activity
    && previous.reviewQueue === next.reviewQueue && previous.chatRow === next.chatRow && previous.onSelect === next.onSelect
    && previous.onSelectTab === next.onSelectTab && previous.onCloseTab === next.onCloseTab && previous.onNewChat === next.onNewChat
    && previous.onOpenView === next.onOpenView && previous.onShowBrowser === next.onShowBrowser && previous.viewHints === next.viewHints
    && previous.onRenameChat === next.onRenameChat && previous.onTogglePin === next.onTogglePin
    && previous.onPauseTab === next.onPauseTab && previous.onResumeTab === next.onResumeTab
    && previous.onOpenPresets === next.onOpenPresets && previous.onSizeChange === next.onSizeChange
    && previous.onDock === next.onDock && previous.onHide === next.onHide && previous.onResize === next.onResize
}

export const ChatCanvas = memo(ChatCanvasInner, chatCanvasPropsEqual)
