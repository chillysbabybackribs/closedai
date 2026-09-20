import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ContextMenu, DropdownMenu } from 'radix-ui'
import { Columns2, GripVertical, Maximize2, MessageSquarePlus, Minimize2, Monitor, PanelRightClose, Plus, Rows2, X } from 'lucide-react'
import { BROWSER_PANE_ID, CHAT_DRAG_TYPE, layoutGeometry, minimumSize, paneIds, removePane, type ChatLayout, type DockEdge, type Rect } from './layout-tree.js'
import { ChatTabs } from './chat-tabs.js'
import { CHAT_TAB_DRAG_TYPE } from './layout-tabs.js'

const position = (rect: Rect): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })

export function ChatCanvas({ tree, selectedId, busy, browserVisible, browserRevealVersion, onToggleBrowser, renderBrowser, onDragActive, title, renderPane, onSelect, onSelectTab, onCloseTab, onNewChat, onDock, onHide, onResize }: {
  tree: ChatLayout
  selectedId: string
  busy: boolean
  browserVisible: boolean
  browserRevealVersion?: number
  renderBrowser: ReactNode
  onDragActive: (active: boolean) => void
  onToggleBrowser: () => void
  title: (id: string) => string
  renderPane: (id: string) => ReactNode
  onSelect: (id: string) => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewChat: (id: string) => void
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
      {tiles.flatMap(({ id: activeId, tabs, rect }) => {
        const isThisTileSolo = soloTile ? (soloTile.id === activeId || soloTile.tabs.includes(activeId)) : false
        const tileRect = isThisTileSolo ? soloRect : rect
        return tabs.map((id) => <section key={id}
          className="chat-layout-tile" style={position(tileRect)} data-pane-id={id === BROWSER_PANE_ID ? undefined : id}
          data-solo={isThisTileSolo ? 'true' : undefined}
          hidden={soloTile ? (!isThisTileSolo || id !== activeId) : (id !== activeId || (id === BROWSER_PANE_ID && !browserVisible))}
          data-selected={id === selectedId} aria-label={id === BROWSER_PANE_ID ? 'Browser' : title(id)}
          onFocusCapture={(event) => { if (id !== BROWSER_PANE_ID && id !== selectedId && !(event.target as HTMLElement).closest('[role="tablist"]')) onSelect(id) }}
          onPointerDownCapture={(event) => { if (id !== BROWSER_PANE_ID && id !== selectedId && !(event.target as HTMLElement).closest('[role="tablist"]')) onSelect(id) }}
          onDragOver={(event) => {
            if (busy || !event.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return
            if (soloTile) setSoloPaneId(null)
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const bounds = event.currentTarget.getBoundingClientRect()
            const x = (event.clientX - bounds.left) / bounds.width
            const y = (event.clientY - bounds.top) / bounds.height
            const edges: Array<[DockEdge, number]> = [['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]]
            const edge = id === BROWSER_PANE_ID ? (x < 0.5 ? 'left' : 'right')
              : (event.target as HTMLElement).closest('.chat-layout-header') ? null
              : edges.sort((a, b) => a[1] - b[1])[0]![0]
            dropTarget.current = { target: id, edge }
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
            if (busy || !source || !target || target.target !== id) return
            event.preventDefault()
            event.stopPropagation()
            onDock(source, id, target.edge, event.dataTransfer.types.includes(CHAT_TAB_DRAG_TYPE))
            dropTarget.current = null
            setDragging(null)
            setDrop(null)
            onDragActive(false)
          }}>
          {id !== BROWSER_PANE_ID && id === activeId && <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <header className="chat-layout-header"
                onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return
                  if (canMaximize || isThisTileSolo) {
                    setSoloPaneId((current) => current ? null : id)
                  }
                }}
              >
                <button className="chat-layout-title" draggable={!busy} data-ui="layout.pane-drag" data-ui-key={id}
                  aria-label={`Move pane: ${title(id)}`}
                  title={isThisTileSolo ? `${title(id)} — Tile maximized; right-click or press Esc to restore split grid` : `${title(id)} — Drag to move, right-click for layout options`}
                  onClick={() => onSelect(id)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(CHAT_DRAG_TYPE, id)
                    event.dataTransfer.effectAllowed = 'move'
                    setDragging({ id, singleTab: false })
                  }}>
                  <GripVertical size={13} aria-hidden="true" />
                </button>
                <ChatTabs ids={tabs} activeId={id} busy={busy} canClose={tabs.length > 1 || chatCount > 1}
                  title={title} onSelect={(tab) => { tabFocus.current = tab; onSelectTab(tab) }} onClose={onCloseTab}
                  onDrag={(tab) => setDragging({ id: tab, singleTab: true })} />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button type="button" className="chat-layout-new-chat"
                      data-ui="layout.new-chat-menu" data-ui-key={id} disabled={busy}
                      title="New chat" aria-label="New chat">
                      <Plus size={14} aria-hidden="true" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="titlebar-menu-content chat-layout-new-chat-menu" align="end" sideOffset={4} loop>
                      <DropdownMenu.Item className="titlebar-menu-item" data-ui="layout.new-chat" data-ui-key={id}
                        onSelect={() => onNewChat(id)}>
                        <MessageSquarePlus size={14} aria-hidden="true" /><span>New chat tab</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="titlebar-menu-item" data-ui="layout.split-right" data-ui-key={id}
                        onSelect={() => {
                          if (soloTile) setSoloPaneId(null)
                          onDock(null, id, 'right')
                        }}>
                        <Columns2 size={14} aria-hidden="true" /><span>New chat right</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="titlebar-menu-item" data-ui="layout.split-below" data-ui-key={id}
                        onSelect={() => {
                          if (soloTile) setSoloPaneId(null)
                          onDock(null, id, 'bottom')
                        }}>
                        <Rows2 size={14} aria-hidden="true" /><span>New chat bottom</span>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <button type="button" data-ui="layout.browser-toggle" data-ui-key={id}
                  aria-pressed={browserVisible} onClick={() => {
                    if (soloTile) setSoloPaneId(null)
                    onToggleBrowser()
                  }}
                  aria-label={browserVisible ? 'Hide browser' : 'Show browser'}
                  title={browserVisible ? 'Hide browser' : 'Show browser'}>
                  {browserVisible ? <PanelRightClose size={14} aria-hidden="true" /> : <Monitor size={14} aria-hidden="true" />}
                </button>
                <button data-ui="layout.pane-hide" data-ui-key={id} disabled={busy || chatCount < 2}
                  title="Hide this pane; its chat keeps running" aria-label="Hide chat pane" onClick={() => {
                    if (soloTile) setSoloPaneId(null)
                    onHide(id)
                  }}>
                  <X size={14} aria-hidden="true" />
                </button>
              </header>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="titlebar-menu-content chat-layout-context-menu" loop>
                {isThisTileSolo ? (
                  <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.restore" data-ui-key={id}
                    onSelect={() => setSoloPaneId(null)}>
                    <div className="chat-layout-menu-item-left">
                      <Minimize2 size={14} aria-hidden="true" />
                      <span>Restore split grid</span>
                    </div>
                    <span className="titlebar-menu-shortcut">Esc</span>
                  </ContextMenu.Item>
                ) : (
                  <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.maximize" data-ui-key={id}
                    disabled={!canMaximize}
                    onSelect={() => setSoloPaneId(id)}>
                    <div className="chat-layout-menu-item-left">
                      <Maximize2 size={14} aria-hidden="true" />
                      <span>Maximize tile</span>
                    </div>
                  </ContextMenu.Item>
                )}
                <ContextMenu.Separator className="titlebar-menu-separator" />
                <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.split-right" data-ui-key={id}
                  onSelect={() => {
                    if (soloTile) setSoloPaneId(null)
                    onDock(null, id, 'right')
                  }}>
                  <div className="chat-layout-menu-item-left">
                    <Columns2 size={14} aria-hidden="true" />
                    <span>Split right</span>
                  </div>
                </ContextMenu.Item>
                <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.split-below" data-ui-key={id}
                  onSelect={() => {
                    if (soloTile) setSoloPaneId(null)
                    onDock(null, id, 'bottom')
                  }}>
                  <div className="chat-layout-menu-item-left">
                    <Rows2 size={14} aria-hidden="true" />
                    <span>Split below</span>
                  </div>
                </ContextMenu.Item>
                <ContextMenu.Separator className="titlebar-menu-separator" />
                <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.new-chat" data-ui-key={id}
                  onSelect={() => onNewChat(id)}>
                  <div className="chat-layout-menu-item-left">
                    <MessageSquarePlus size={14} aria-hidden="true" />
                    <span>New chat</span>
                  </div>
                </ContextMenu.Item>
                <ContextMenu.Item className="titlebar-menu-item" data-ui="layout.pane-hide" data-ui-key={id}
                  disabled={busy || (chatCount < 2 && tabs.length < 2)}
                  onSelect={() => {
                    if (soloTile) setSoloPaneId(null)
                    if (tabs.length > 1) onCloseTab(id)
                    else onHide(id)
                  }}>
                  <div className="chat-layout-menu-item-left">
                    <X size={14} aria-hidden="true" />
                    <span>{tabs.length > 1 ? 'Close tab' : 'Hide pane'}</span>
                  </div>
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>}
          {id === BROWSER_PANE_ID ? <div className="chat-layout-browser-frame" data-ui="layout.browser-dock">
            {renderBrowser}
            {dragging && <div className="chat-layout-browser-shield">Drop on either side to place a chat beside the browser</div>}
          </div> : <div className="chat-layout-content" role="tabpanel" id={`chat-panel-${id}`}
            aria-label={title(id)}>{renderPane(id)}</div>}
          {drop?.target === id && (dragging?.id !== id || (dragging.singleTab && tabs.length > 1)) && <div className="chat-layout-drop" data-edge={drop.edge ?? 'tab'}>
            <span>{drop.edge === null ? 'Move to tab strip' : drop.edge === 'top' ? 'Place above' : drop.edge === 'bottom' ? 'Place below' : `Place ${drop.edge}`}</span>
          </div>}
        </section>)
      })}
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
