import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { Plus, X } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { ChatLayoutContextMenu } from './layout-context-menu.js'
import { AGENT_WORKSPACE_PANE_ID, BROWSER_PANE_ID, CHAT_DRAG_TYPE, WORKSPACE_DOCK_ID, hiddenReservedPanes, layoutForGeometry, layoutGeometry, minimumSize, paneIds, type ChatLayout, type DockEdge, type Rect } from './layout-tree.js'
import { ChatTabs } from './chat-tabs.js'
import { LayoutDivider } from './layout-divider.js'
import { CHAT_TAB_DRAG_TYPE } from './layout-tabs.js'
import type { TabActivity } from './tab-activity.js'
import { paneHideHint, tabCloseHint } from './layout-copy.js'
import { browserDropAt, browserDropPreview, sameBrowserDrop, type BrowserDrop } from './browser-drop.js'
import { useNativeViewBounds } from '../native-view-bounds.js'


const isBrowserPane = (id: string): boolean => id === BROWSER_PANE_ID
const isAgentPane = (id: string): boolean => id === AGENT_WORKSPACE_PANE_ID
const isReservedPane = (id: string): boolean => isBrowserPane(id) || isAgentPane(id)

const position = (rect: Rect): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })

export type AgentSoloControls = { toggleSolo: () => void; solo: boolean }

export function ChatCanvas({ tree, selectedId, busy, notice, toolsPreset = null, browserVisible, agentVisible, browserRevealVersion, renderBrowser, renderAgent, onDragActive, title, activity, chatRow, renderPane, onSelect, onSelectTab, onCloseTab, onNewChat, onRenameChat, onTogglePin, onPauseTab, onResumeTab, onOpenPresets, onSizeChange, onDock, onHide, onResize }: {
  tree: ChatLayout
  selectedId: string
  busy: boolean
  notice?: string
  browserVisible: boolean
  agentVisible: boolean
  browserRevealVersion?: number
  renderBrowser: ReactNode
  renderAgent?: (controls: AgentSoloControls) => ReactNode
  onDragActive: (active: boolean) => void
  title: (id: string) => string
  activity?: (id: string) => TabActivity
  chatRow?: (id: string) => ChatRowSummary | undefined
  renderPane: (id: string) => ReactNode
  onSelect: (id: string) => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewChat: (id: string) => void
  /** The tools preset; the header names it while it is Read-only. */
  toolsPreset?: 'full' | 'read-only' | 'custom' | null
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
  const visibleTree = layoutForGeometry(tree, browserVisible, agentVisible)
  const geometry = layoutGeometry(visibleTree, size.width, size.height)
  const minimum = minimumSize(visibleTree)
  const zeroRect = { x: 0, y: 0, width: 0, height: 0 }
  const tiles = [...geometry.panes]
  for (const id of hiddenReservedPanes(tree, browserVisible, agentVisible)) {
    if (!tiles.some((tile) => tile.id === id)) tiles.push({ id, tabs: [id], rect: zeroRect })
  }
  const chatCount = paneIds(tree).length
  const canMaximize = chatCount > 1 || ((browserVisible || agentVisible) && chatCount >= 1)
  const soloTile = soloPaneId
    ? geometry.panes.find((p) => p.id === soloPaneId || p.tabs.includes(soloPaneId))
    : null

  // Plain DOM (unlike the native browser view), so a collapsed host already reports a zero
  // rect on its own; the report just needs to reach the main process for capture to crop to it.
  const agentBoundsRef = useNativeViewBounds(async (bounds) => {
    await window.closedai.agentWorkspace.setBounds({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      visible: bounds.width > 1 && bounds.height > 1
    })
  }, JSON.stringify([agentVisible, soloPaneId, tree]), true)

  useEffect(() => {
    if (!soloPaneId) return
    const exists = geometry.panes.some((p) => p.id === soloPaneId || p.tabs.includes(soloPaneId))
    if (!exists || (chatCount <= 1 && !browserVisible && !agentVisible)) {
      setSoloPaneId(null)
    }
  }, [soloPaneId, geometry.panes, chatCount, browserVisible, agentVisible])

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
        const tileKey = isReservedPane(activeId) ? activeId : (tabs[0] ?? activeId)
        const hideHint = paneHideHint(tabs.map((id) => activity?.(id)?.state))
        const closeHint = tabCloseHint(activity?.(activeId)?.state)
        const row = chatRow?.(activeId)
        return <section key={tileKey}
          className="chat-layout-tile" style={position(tileRect)} data-pane-id={isReservedPane(activeId) ? undefined : activeId}
          data-solo={isThisTileSolo ? 'true' : undefined}
          hidden={soloTile ? !isThisTileSolo : ((isBrowserPane(activeId) && !browserVisible) || (isAgentPane(activeId) && !agentVisible))}
          data-selected={activeId === selectedId || tabs.includes(selectedId)} aria-label={isBrowserPane(activeId) ? 'Browser' : isAgentPane(activeId) ? 'Agent workspace' : title(activeId)}
          onFocusCapture={(event) => { if (!isReservedPane(activeId) && activeId !== selectedId && !(event.target as HTMLElement).closest('[role="tablist"]')) onSelect(activeId) }}
          onPointerDownCapture={(event) => { if (!isReservedPane(activeId) && activeId !== selectedId && !(event.target as HTMLElement).closest('[role="tablist"]')) onSelect(activeId) }}
          onDragOver={(event) => {
            if (busy || !event.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return
            if (soloTile) setSoloPaneId(null)
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const bounds = event.currentTarget.getBoundingClientRect()
            const x = (event.clientX - bounds.left) / bounds.width
            const y = (event.clientY - bounds.top) / bounds.height
            const edges: Array<[DockEdge, number]> = [['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]]
            const edge = isReservedPane(activeId) ? (x < 0.5 ? 'left' : 'right')
              : dragging?.id !== BROWSER_PANE_ID && dragging?.id !== AGENT_WORKSPACE_PANE_ID && (event.target as HTMLElement).closest('.chat-layout-header') ? null
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
          {!isReservedPane(activeId) && <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <header className="chat-layout-header"
                onClick={(event) => {
                  if (!(event.target as HTMLElement).closest('button')) onSelect(activeId)
                }}
                onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return
                  if (canMaximize || isThisTileSolo) {
                    setSoloPaneId((current) => current ? null : activeId)
                  }
                }}
              >
                <button type="button" className="chat-layout-drag" data-ui="layout.pane-drag" data-ui-key={activeId}
                  draggable={!busy} disabled={busy} aria-label="Drag to move chat pane"
                  title="Drag to move whole pane · Tab drags move one conversation"
                  onDragStart={(event) => {
                    event.dataTransfer.setData(CHAT_DRAG_TYPE, activeId)
                    event.dataTransfer.effectAllowed = 'move'
                    setDragging({ id: activeId, singleTab: false })
                  }}>
                  <span className="chat-layout-drag-dots" aria-hidden="true" />
                </button>
                <ChatTabs ids={tabs} activeId={activeId} busy={busy} canClose={tabs.length > 1 || chatCount > 1}
                  title={title} activity={activity} onSelect={(tab) => { tabFocus.current = tab; onSelectTab(tab) }} onClose={onCloseTab}
                  onDrag={(tab) => setDragging({ id: tab, singleTab: true })} />
                {toolsPreset === 'read-only' && <span className="chat-layout-preset" data-ui="layout.tools-preset"
                  title="Tools are in Read-only: the model can look but not act. Change it in Agent → Tools & capabilities.">Read-only</span>}
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
          {isBrowserPane(activeId) ? <div className="chat-layout-browser-frame" data-ui="layout.browser-dock">
            {renderBrowser}
            {dragging && <div className="chat-layout-browser-shield">{dragging.id === BROWSER_PANE_ID
              ? 'Drop above or below a chat to stack; use the workspace edges for a full-height column'
              : 'Drop on either side to place a chat beside the browser'}</div>}
          </div> : isAgentPane(activeId) ? <div className="chat-layout-agent-frame" data-ui="layout.agent-dock" ref={agentBoundsRef}>
            {renderAgent?.({ toggleSolo: () => setSoloPaneId((current) => current === AGENT_WORKSPACE_PANE_ID ? null : AGENT_WORKSPACE_PANE_ID), solo: isThisTileSolo })}
          </div> : tabs.map((tabId) => <div key={tabId} className="chat-layout-content" role="tabpanel" id={`chat-panel-${tabId}`}
            aria-label={title(tabId)} hidden={tabId !== activeId}>{renderPane(tabId)}</div>)}
          {dragging?.id !== BROWSER_PANE_ID && drop?.target === activeId && (dragging?.id !== activeId || (dragging.singleTab && tabs.length > 1)) && <div className="chat-layout-drop" data-edge={drop.edge ?? 'tab'}>
            <span>{drop.edge === null ? 'Move to tab strip' : drop.edge === 'top' ? 'Place above' : drop.edge === 'bottom' ? 'Place below' : `Place on the ${drop.edge}`}</span>
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
