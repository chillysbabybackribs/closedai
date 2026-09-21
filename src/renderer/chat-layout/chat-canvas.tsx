import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { Plus, X } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { ChatLayoutContextMenu } from './layout-context-menu.js'
import { BROWSER_PANE_ID, CHAT_DRAG_TYPE, WORKSPACE_DOCK_ID, layoutGeometry, minimumSize, paneIds, removePane, type ChatLayout, type DockEdge, type Rect } from './layout-tree.js'
import { ChatTabs } from './chat-tabs.js'
import { LayoutDivider } from './layout-divider.js'
import { CHAT_TAB_DRAG_TYPE } from './layout-tabs.js'
import type { TabActivity } from './tab-activity.js'
import { paneHideHint, tabCloseHint } from './layout-copy.js'
import { browserDropAt, browserDropPreview, sameBrowserDrop, type BrowserDrop } from './browser-drop.js'

const position = (rect: Rect): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })

export function ChatCanvas({ tree, selectedId, busy, notice, browserVisible, browserRevealVersion, renderBrowser, onDragActive, title, activity, chatRow, renderPane, onSelect, onSelectTab, onCloseTab, onNewChat, onRenameChat, onTogglePin, onPauseTab, onResumeTab, onOpenPresets, onSizeChange, onDock, onHide, onResize }: {
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
  chatRow?: (id: string) => ChatRowSummary | undefined
  renderPane: (id: string) => ReactNode
  onSelect: (id: string) => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewChat: (id: string) => void
  onRenameChat?: (id: string) => void
  onTogglePin?: (id: string, pinned: boolean) => void
  onPauseTab?: (id: string) => void
  onResumeTab?: (id: string) => void
  onOpenPresets?: () => void
  /** Tile canvas content box, for arranging presets against the real space. */
  onSizeChange?: (size: { width: number; height: number }) => void
  onDock: (id: string | null, target: string, edge: DockEdge | null, singleTab?: boolean) => void
  onHide: (id: string) => void
  onResize: (id: string, ratio: number) => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState<{ id: string; singleTab: boolean } | null>(null)
  const [drop, setDrop] = useState<{ target: string; edge: DockEdge | null } | null>(null)
  const dropTarget = useRef<typeof drop>(null)
  const tabFocus = useRef<string | null>(null)
  const paneDragBlocked = useRef(false)
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
    const clear = (): void => { setDragging(null); setDrop(null); dropTarget.current = null; onDragActive(false) }
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
  const minimum = minimumSize(visibleTree)
  // Keep the browser host mounted while hidden, just as inactive conversation tabs are.
  const tiles = browserVisible ? geometry.panes : [...geometry.panes,
    { id: BROWSER_PANE_ID, tabs: [BROWSER_PANE_ID], rect: { x: 0, y: 0, width: 0, height: 0 } }]
  const chatCount = paneIds(tree).length
  const canMaximize = chatCount > 1 || (browserVisible && chatCount >= 1)
  const soloTile = soloPaneId
    ? geometry.panes.find((p) => p.id === soloPaneId || p.tabs.includes(soloPaneId))
    : null

  useEffect(() => {
    if (!soloPaneId) return
    const exists = geometry.panes.some((p) => p.id === soloPaneId || p.tabs.includes(soloPaneId))
    if (!exists || (chatCount <= 1 && !browserVisible)) {
      setSoloPaneId(null)
    }
  }, [soloPaneId, geometry.panes, chatCount, browserVisible])

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
  const preview = browserDrop ? browserDropPreview(tree, browserDrop, size.width, size.height) : null
  const resolveBrowserDrop = (element: HTMLElement, x: number, y: number): BrowserDrop | null => {
    const bounds = element.getBoundingClientRect()
    return browserDropAt(geometry.panes, bounds.width, bounds.height, x - bounds.left, y - bounds.top,
      dropTarget.current?.edge ? dropTarget.current as BrowserDrop : null)
  }

  return <div className="chat-layout-viewport" ref={viewport}>
    <div className="chat-layout-canvas" style={{ minWidth: minimum.width, minHeight: minimum.height }}
      onDragOverCapture={(event) => {
        if (dragging?.id !== BROWSER_PANE_ID) return
        event.stopPropagation()
        if (busy) { event.dataTransfer.dropEffect = 'none'; return }
        event.preventDefault()
        if (soloTile) setSoloPaneId(null)
        const next = resolveBrowserDrop(event.currentTarget, event.clientX, event.clientY)
        event.dataTransfer.dropEffect = next ? 'move' : 'none'
        if (sameBrowserDrop(browserDrop, next)) return
        dropTarget.current = next
        setDrop(next)
      }}
      onDragLeave={(event) => {
        if (dragging?.id !== BROWSER_PANE_ID) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX <= bounds.left || event.clientX >= bounds.right || event.clientY <= bounds.top || event.clientY >= bounds.bottom) {
          dropTarget.current = null
          setDrop(null)
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
        const tileRect = isThisTileSolo ? soloRect : rect
        const tileKey = activeId === BROWSER_PANE_ID ? BROWSER_PANE_ID : (tabs[0] ?? activeId)
        const hideHint = paneHideHint(tabs.map((id) => activity?.(id)?.state))
        const closeHint = tabCloseHint(activity?.(activeId)?.state)
        const row = chatRow?.(activeId)
        return <section key={tileKey}
          className="chat-layout-tile" style={position(tileRect)} data-pane-id={activeId === BROWSER_PANE_ID ? undefined : activeId}
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
            dropTarget.current = { target: activeId, edge }
            setDrop(dropTarget.current)
          }}
          onDragLeave={(event) => {
            if (dragging?.id === BROWSER_PANE_ID) return
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              dropTarget.current = null
              setDrop(null)
            }
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
          {activeId !== BROWSER_PANE_ID && <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <header className="chat-layout-header" draggable={!busy}
                data-ui="layout.pane-drag" data-ui-key={activeId}
                onPointerDownCapture={(event) => {
                  paneDragBlocked.current = (event.target as HTMLElement).closest('button') !== null
                }}
                onClick={(event) => {
                  if (!(event.target as HTMLElement).closest('button')) onSelect(activeId)
                }}
                onDragStart={(event) => {
                  // Tabs carry their own single-conversation payload. Only empty header space
                  // moves the entire pane; action buttons must never start a pane drag.
                  if (event.dataTransfer.types.includes(CHAT_TAB_DRAG_TYPE)) return
                  if (busy || paneDragBlocked.current || (event.target as HTMLElement).closest('button')) {
                    event.preventDefault()
                    return
                  }
                  event.dataTransfer.setData(CHAT_DRAG_TYPE, activeId)
                  event.dataTransfer.effectAllowed = 'move'
                  setDragging({ id: activeId, singleTab: false })
                }}
                onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return
                  if (canMaximize || isThisTileSolo) {
                    setSoloPaneId((current) => current ? null : activeId)
                  }
                }}
              >
                <ChatTabs ids={tabs} activeId={activeId} busy={busy} canClose={tabs.length > 1 || chatCount > 1}
                  title={title} activity={activity} onSelect={(tab) => { tabFocus.current = tab; onSelectTab(tab) }} onClose={onCloseTab}
                  onDrag={(tab) => setDragging({ id: tab, singleTab: true })} />
                <button type="button" className="chat-layout-new-chat"
                  data-ui="layout.new-chat" data-ui-key={activeId} disabled={busy}
                  title="New chat tab" aria-label="New chat tab"
                  onClick={() => onNewChat(activeId)}>
                  <Plus size={14} aria-hidden="true" />
                </button>
                <button data-ui="layout.pane-hide" data-ui-key={activeId} disabled={busy || chatCount < 2}
                  title={`Hide pane · ${hideHint}`} aria-label={`Hide chat pane · ${hideHint}`} onClick={() => {
                    if (soloTile) setSoloPaneId(null)
                    onHide(activeId)
                  }}>
                  <X size={14} aria-hidden="true" />
                </button>
              </header>
            </ContextMenu.Trigger>
            <ChatLayoutContextMenu activeId={activeId} tabs={tabs} chatCount={chatCount} busy={busy}
              hideHint={hideHint} closeHint={closeHint} tabActivity={activity?.(activeId)}
              pinned={row?.pinnedAt != null}
              onOpenPresets={onOpenPresets ? () => { if (soloTile) setSoloPaneId(null); onOpenPresets() } : undefined}
              onRename={onRenameChat ? () => onRenameChat(activeId) : undefined}
              onTogglePin={onTogglePin ? () => onTogglePin(activeId, row?.pinnedAt == null) : undefined}
              onPause={onPauseTab ? () => onPauseTab(activeId) : undefined}
              onResume={onResumeTab ? () => onResumeTab(activeId) : undefined}
              onCloseTab={() => { if (soloTile) setSoloPaneId(null); onCloseTab(activeId) }}
              onHide={() => { if (soloTile) setSoloPaneId(null); onHide(activeId) }} />
          </ContextMenu.Root>}
          {activeId === selectedId && <div className="chat-layout-notice" role="status" aria-atomic="true">{notice}</div>}
          {activeId === BROWSER_PANE_ID ? <div className="chat-layout-browser-frame" data-ui="layout.browser-dock">
            {renderBrowser}
            {dragging && <div className="chat-layout-browser-shield">{dragging.id === BROWSER_PANE_ID
              ? 'Drop above or below a chat to stack; use the workspace edges for a full-height column'
              : 'Drop on either side to place a chat beside the browser'}</div>}
          </div> : tabs.map((tabId) => <div key={tabId} className="chat-layout-content" role="tabpanel" id={`chat-panel-${tabId}`}
            aria-label={title(tabId)} hidden={tabId !== activeId}>{renderPane(tabId)}</div>)}
          {dragging?.id !== BROWSER_PANE_ID && drop?.target === activeId && (dragging?.id !== activeId || (dragging.singleTab && tabs.length > 1)) && <div className="chat-layout-drop" data-edge={drop.edge ?? 'tab'}>
            <span>{drop.edge === null ? 'Move to tab strip' : drop.edge === 'top' ? 'Place above' : drop.edge === 'bottom' ? 'Place below' : `Place ${drop.edge}`}</span>
          </div>}
        </section>
      })}
      {dragging?.id === BROWSER_PANE_ID && !busy && <>
        {(['left', 'right'] as const).map((edge) => <div key={edge}
          className="chat-layout-workspace-dock" data-edge={edge} data-ui="layout.workspace-dock" data-ui-key={edge}
          data-active={browserDrop?.target === WORKSPACE_DOCK_ID && browserDrop.edge === edge}
          aria-label={`Move browser to full-height ${edge} column`}
        ><span>Full-height column</span></div>)}
        {preview?.panes.map(({ id, rect }) => <div key={id} className="chat-layout-browser-preview"
          data-browser={id === BROWSER_PANE_ID} style={position(rect)}>
          {id === BROWSER_PANE_ID && <span role="status">Release to place browser {browserDrop?.target === WORKSPACE_DOCK_ID
            ? `in a full-height ${browserDrop.edge} column`
            : `${browserDrop?.edge === 'top' ? 'above' : browserDrop?.edge === 'bottom' ? 'below' : `to the ${browserDrop?.edge} of`} ${title(browserDrop!.target)}`}
            <br /><small>Esc to cancel</small></span>}
        </div>)}
      </>}
      {!soloTile && geometry.dividers.map((divider) => <LayoutDivider key={divider.id}
        divider={divider} onResize={onResize} />)}
    </div>
  </div>
}
