import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { Columns2, Maximize2, MessageSquarePlus, Minimize2, Monitor, PanelRightClose, Pencil, Plus, Rows2, Sparkles, X } from 'lucide-react'
import { BROWSER_PANE_ID, CHAT_DRAG_TYPE, WORKSPACE_DOCK_ID, layoutGeometry, minimumSize, paneIds, removePane, type ChatLayout, type DockEdge, type Rect } from './layout-tree.js'
import { ChatTabs } from './chat-tabs.js'
import { CHAT_TAB_DRAG_TYPE } from './layout-tabs.js'
import type { TabActivity } from './tab-activity.js'

const position = (rect: Rect): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })

export function ChatCanvas({ tree, selectedId, busy, browserVisible, browserRevealVersion, onToggleBrowser, renderBrowser, onDragActive, title, activity, renderPane, onSelect, onSelectTab, onCloseTab, onNewChat, onRenameChat, onRetryChatTitle, onDock, onHide, onResize }: {
  tree: ChatLayout
  selectedId: string
  busy: boolean
  browserVisible: boolean
  browserRevealVersion?: number
  renderBrowser: ReactNode
  onDragActive: (active: boolean) => void
  onToggleBrowser: () => void
  title: (id: string) => string
  activity?: (id: string) => TabActivity
  renderPane: (id: string) => ReactNode
  onSelect: (id: string) => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewChat: (id: string) => void
  onRenameChat?: (id: string) => void
  onRetryChatTitle?: (id: string) => void
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
  const resize = useRef<{ id: string; pointerId: number; start: number; ratio: number; length: number; axis: string; min: number; max: number } | null>(null)
  useEffect(() => {
    // Follow the gesture even when Chromium delivers its next move over a sibling tile.
    const move = (event: PointerEvent): void => {
      const active = resize.current
      if (!active || event.pointerId !== active.pointerId) return
      const delta = (active.axis === 'horizontal' ? event.clientX : event.clientY) - active.start
      onResize(active.id, Math.max(active.min, Math.min(active.max, active.ratio + delta / active.length)))
    }
    const end = (): void => { resize.current = null }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
    }
  }, [onResize])
  useEffect(() => {
    const host = viewport.current!
    const observer = new ResizeObserver(() => setSize({ width: host.clientWidth, height: host.clientHeight }))
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
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
      window.removeEventListener('blur', clear)
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

  return <div className="chat-layout-viewport" ref={viewport}>
    <div className="chat-layout-canvas" style={{ minWidth: minimum.width, minHeight: minimum.height }}>
      {tiles.map(({ id: activeId, tabs, rect }) => {
        const isThisTileSolo = soloTile ? (soloTile.id === activeId || soloTile.tabs.includes(activeId)) : false
        const tileRect = isThisTileSolo ? soloRect : rect
        const tileKey = activeId === BROWSER_PANE_ID ? BROWSER_PANE_ID : (tabs[0] ?? activeId)
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
                <button type="button" data-ui="layout.browser-toggle" data-ui-key={activeId}
                  aria-pressed={browserVisible} onClick={() => {
                    if (soloTile) setSoloPaneId(null)
                    onToggleBrowser()
                  }}
                  aria-label={browserVisible ? 'Hide browser' : 'Show browser'}
                  title={browserVisible ? 'Hide browser' : 'Show browser'}>
                  {browserVisible ? <PanelRightClose size={14} aria-hidden="true" /> : <Monitor size={14} aria-hidden="true" />}
                </button>
                <button data-ui="layout.pane-hide" data-ui-key={activeId} disabled={busy || chatCount < 2}
                  title="Hide this pane; its chat keeps running" aria-label="Hide chat pane" onClick={() => {
                    if (soloTile) setSoloPaneId(null)
                    onHide(activeId)
                  }}>
                  <X size={14} aria-hidden="true" />
                </button>
              </header>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="titlebar-menu-content chat-layout-context-menu" loop>
                {isThisTileSolo ? (
                  <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.restore" data-ui-key={activeId}
                    onSelect={() => setSoloPaneId(null)}>
                    <div className="chat-layout-menu-item-left">
                      <Minimize2 size={14} aria-hidden="true" />
                      <span>Restore split grid</span>
                    </div>
                    <span className="titlebar-menu-shortcut">Esc</span>
                  </ContextMenu.Item>
                ) : (
                  <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.maximize" data-ui-key={activeId}
                    disabled={!canMaximize}
                    onSelect={() => setSoloPaneId(activeId)}>
                    <div className="chat-layout-menu-item-left">
                      <Maximize2 size={14} aria-hidden="true" />
                      <span>Maximize tile</span>
                    </div>
                  </ContextMenu.Item>
                )}
                <ContextMenu.Separator className="titlebar-menu-separator" />
                <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.split-right" data-ui-key={activeId}
                  onSelect={() => {
                    if (soloTile) setSoloPaneId(null)
                    onDock(null, activeId, 'right')
                  }}>
                  <div className="chat-layout-menu-item-left">
                    <Columns2 size={14} aria-hidden="true" />
                    <span>Split right</span>
                  </div>
                </ContextMenu.Item>
                <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.split-below" data-ui-key={activeId}
                  onSelect={() => {
                    if (soloTile) setSoloPaneId(null)
                    onDock(null, activeId, 'bottom')
                  }}>
                  <div className="chat-layout-menu-item-left">
                    <Rows2 size={14} aria-hidden="true" />
                    <span>Split below</span>
                  </div>
                </ContextMenu.Item>
                {onRenameChat && (
                  <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.rename" data-ui-key={activeId}
                    onSelect={() => onRenameChat(activeId)}>
                    <div className="chat-layout-menu-item-left">
                      <Pencil size={14} aria-hidden="true" />
                      <span>Rename chat</span>
                    </div>
                  </ContextMenu.Item>
                )}
                {onRetryChatTitle && (
                  <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.retry-title" data-ui-key={activeId}
                    onSelect={() => onRetryChatTitle(activeId)}>
                    <div className="chat-layout-menu-item-left">
                      <Sparkles size={14} aria-hidden="true" />
                      <span>Generate title</span>
                    </div>
                  </ContextMenu.Item>
                )}
                <ContextMenu.Separator className="titlebar-menu-separator" />
                <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.new-chat" data-ui-key={activeId}
                  onSelect={() => onNewChat(activeId)}>
                  <div className="chat-layout-menu-item-left">
                    <MessageSquarePlus size={14} aria-hidden="true" />
                    <span>New chat</span>
                  </div>
                </ContextMenu.Item>
                <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.pane-hide" data-ui-key={activeId}
                  disabled={busy || (chatCount < 2 && tabs.length < 2)}
                  onSelect={() => {
                    if (soloTile) setSoloPaneId(null)
                    if (tabs.length > 1) onCloseTab(activeId)
                    else onHide(activeId)
                  }}>
                  <div className="chat-layout-menu-item-left">
                    <X size={14} aria-hidden="true" />
                    <span>{tabs.length > 1 ? 'Close tab' : 'Hide pane'}</span>
                  </div>
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>}
          {activeId === BROWSER_PANE_ID ? <div className="chat-layout-browser-frame" data-ui="layout.browser-dock">
            {renderBrowser}
            {dragging && <div className="chat-layout-browser-shield">{dragging.id === BROWSER_PANE_ID
              ? 'Drop above or below a chat to stack; use the workspace edges for a full-height column'
              : 'Drop on either side to place a chat beside the browser'}</div>}
          </div> : tabs.map((tabId) => <div key={tabId} className="chat-layout-content" role="tabpanel" id={`chat-panel-${tabId}`}
            aria-label={title(tabId)} hidden={tabId !== activeId}>{renderPane(tabId)}</div>)}
          {drop?.target === activeId && (dragging?.id !== activeId || (dragging.singleTab && tabs.length > 1)) && <div className="chat-layout-drop" data-edge={drop.edge ?? 'tab'}>
            <span>{drop.edge === null ? 'Move to tab strip' : drop.edge === 'top' ? 'Place above' : drop.edge === 'bottom' ? 'Place below' : `Place ${drop.edge}`}</span>
          </div>}
        </section>
      })}
      {dragging?.id === BROWSER_PANE_ID && !busy && <>
        {(['left', 'right'] as const).map((edge) => <div key={edge}
          className="chat-layout-workspace-dock" data-edge={edge} data-ui="layout.workspace-dock" data-ui-key={edge}
          aria-label={`Move browser to full-height ${edge} column`}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            dropTarget.current = { target: WORKSPACE_DOCK_ID, edge }
            setDrop(dropTarget.current)
          }}
          onDragLeave={() => { dropTarget.current = null; setDrop(null) }}
          onDrop={(event) => {
            if (event.dataTransfer.getData(CHAT_DRAG_TYPE) !== BROWSER_PANE_ID) return
            event.preventDefault()
            onDock(BROWSER_PANE_ID, WORKSPACE_DOCK_ID, edge)
            dropTarget.current = null
            setDragging(null)
            setDrop(null)
            onDragActive(false)
          }} />)}
        {drop?.target === WORKSPACE_DOCK_ID && <div className="chat-layout-drop" data-edge={drop.edge}>
          <span>Full-height browser column</span>
        </div>}
      </>}
      {!soloTile && geometry.dividers.map((divider) => <div key={divider.id} className="chat-layout-divider"
        style={position(divider.rect)} data-axis={divider.axis} role="separator" tabIndex={0}
        data-ui="layout.divider" data-ui-key={divider.id}
        aria-label="Resize chat panes" aria-orientation={divider.axis === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(divider.ratio * 100)} aria-valuemin={Math.round(divider.min * 100)} aria-valuemax={Math.round(divider.max * 100)}
        onDoubleClick={() => onResize(divider.id, 0.5)}
        onKeyDown={(event) => {
          const keys = divider.axis === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
          if (!keys.includes(event.key)) return
          event.preventDefault()
          const ratio = divider.ratio + (event.key === keys[0] ? -0.05 : 0.05)
          onResize(divider.id, Math.max(divider.min, Math.min(divider.max, ratio)))
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          resize.current = { id: divider.id, pointerId: event.pointerId, start: divider.axis === 'horizontal' ? event.clientX : event.clientY,
            ratio: divider.ratio, length: (divider.axis === 'horizontal' ? divider.parent.width : divider.parent.height) - 5,
            axis: divider.axis, min: divider.min, max: divider.max }
        }}
        onPointerUp={() => { resize.current = null }}
        onLostPointerCapture={() => { resize.current = null }}
      />)}
    </div>
  </div>
}
