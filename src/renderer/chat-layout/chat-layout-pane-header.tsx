import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { ContextMenu } from 'radix-ui'
import { Minus, X } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import { ChatLayoutContextMenu } from './layout-context-menu.js'
import { ChatLayoutPaneHints } from './chat-layout-pane-hints.js'
import { ChatTabs } from './chat-tabs.js'
import { CHAT_DRAG_TYPE, isViewTabId } from './layout-tree.js'
import type { ViewKind } from './layout-views.js'
import { PaneAddMenu, type ViewHints } from './pane-add-menu.js'
import { paneHideHint, tabCloseHint } from './layout-copy.js'
import type { TabActivity } from './tab-activity.js'

function ChatLayoutPaneHeaderBody({ activeId, tabs, chatCount, busy, toolsPreset, title, activity, reviewQueue, row, soloTile, setSoloPaneId, tabFocus, hideHint, closeHint, tabActivity, viewHints, browserVisible, onSelect, onSelectTab, onCloseTab, onNewChat, onOpenView, onShowBrowser, onRenameChat, onTogglePin, onPauseTab, onResumeTab, onOpenPresets, onMinimize, onHide, setDragging, canMaximize, isThisTileSolo }: {
  activeId: string
  tabs: string[]
  chatCount: number
  busy: boolean
  toolsPreset: 'full' | 'read-only' | 'custom' | null
  title: (id: string) => string
  activity?: (id: string) => TabActivity
  reviewQueue?: ChatReviewQueue
  row: ChatRowSummary | undefined
  soloTile: { id: string; tabs: string[] } | null
  setSoloPaneId: Dispatch<SetStateAction<string | null>>
  tabFocus: MutableRefObject<string | null>
  hideHint: string
  closeHint: string
  tabActivity?: TabActivity
  viewHints?: ViewHints
  browserVisible?: boolean
  onSelect: (id: string) => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewChat: (id: string) => void
  onOpenView?: (kind: ViewKind, tileId: string) => void
  onShowBrowser?: () => void
  onRenameChat?: (id: string) => void
  onTogglePin?: (id: string, pinned: boolean) => void
  onPauseTab?: (id: string) => void
  onResumeTab?: (id: string) => void
  onOpenPresets?: () => void
  onMinimize?: (id: string) => void
  onHide: (id: string) => void
  setDragging: (value: { id: string; singleTab: boolean } | null) => void
  canMaximize: boolean
  isThisTileSolo: boolean
}) {
  // A view in front has no chat actions: rename, pin, pause belong to the chat it follows, not the tab.
  const view = isViewTabId(activeId)
  return <ContextMenu.Root>
    <ContextMenu.Trigger asChild>
      <header className="chat-layout-header"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) onSelect(activeId)
        }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
          if (canMaximize || isThisTileSolo) setSoloPaneId((current) => current ? null : activeId)
        }}>
        <button type="button" className="chat-layout-drag" data-ui="layout.pane-drag" data-ui-key={activeId}
          draggable={!busy} disabled={busy} aria-label="Drag to move pane"
          title="Drag to move whole pane · Tab drags move one conversation"
          onDragStart={(event) => {
            event.dataTransfer.setData(CHAT_DRAG_TYPE, activeId)
            event.dataTransfer.effectAllowed = 'move'
            setDragging({ id: activeId, singleTab: false })
          }}>
          <span className="chat-layout-drag-dots" aria-hidden="true" />
        </button>
        <ChatTabs ids={tabs} activeId={activeId} busy={busy} canClose={tabs.length > 1 || chatCount > 1}
          title={title} activity={activity} reviewQueue={reviewQueue}
          onSelect={(tab) => { tabFocus.current = tab; onSelectTab(tab) }} onClose={onCloseTab}
          onDrag={(tab) => setDragging({ id: tab, singleTab: true })} />
        {toolsPreset === 'read-only' && <span className="chat-layout-preset" data-ui="layout.tools-preset"
          title="Tools are in Read-only: the model can look but not act. Change it in Agent → Tools & capabilities.">Read-only</span>}
        {onOpenView
          ? <PaneAddMenu tileId={activeId} busy={busy} hints={viewHints} browserVisible={browserVisible ?? false}
              onNewChat={() => onNewChat(activeId)} onOpenView={(kind) => onOpenView(kind, activeId)} onShowBrowser={onShowBrowser} />
          : <button type="button" className="chat-layout-new-chat"
              data-ui="layout.new-chat" data-ui-key={activeId} disabled={busy}
              title="New chat tab" aria-label="New chat tab"
              onClick={() => onNewChat(activeId)}>+</button>}
        {onMinimize && <button data-ui="layout.pane-minimize" data-ui-key={activeId} disabled={busy}
          title="Dock group" aria-label="Dock group" onClick={() => {
            if (soloTile) setSoloPaneId(null)
            onMinimize(activeId)
          }}><Minus size={14} aria-hidden="true" /></button>}
        <button data-ui="layout.pane-hide" data-ui-key={activeId} disabled={busy || chatCount < 2}
          title={`Hide pane · ${hideHint}`} aria-label={`Hide pane · ${hideHint}`} onClick={() => {
            if (soloTile) setSoloPaneId(null)
            onHide(activeId)
          }}>
          <X size={14} aria-hidden="true" />
        </button>
      </header>
    </ContextMenu.Trigger>
    <ChatLayoutContextMenu activeId={activeId} tabs={tabs} chatCount={chatCount} busy={busy}
      hideHint={hideHint} closeHint={closeHint} tabActivity={tabActivity}
      pinned={row?.pinnedAt != null}
      onOpenPresets={onOpenPresets ? () => { if (soloTile) setSoloPaneId(null); onOpenPresets() } : undefined}
      onRename={onRenameChat && !view ? () => onRenameChat(activeId) : undefined}
      onTogglePin={onTogglePin && !view ? () => onTogglePin(activeId, row?.pinnedAt == null) : undefined}
      onPause={onPauseTab && !view ? () => onPauseTab(activeId) : undefined}
      onResume={onResumeTab && !view ? () => onResumeTab(activeId) : undefined}
      onCloseTab={() => { if (soloTile) setSoloPaneId(null); onCloseTab(activeId) }}
      onHide={() => { if (soloTile) setSoloPaneId(null); onHide(activeId) }} />
  </ContextMenu.Root>
}

type ChatLayoutPaneHeaderProps = Omit<Parameters<typeof ChatLayoutPaneHeaderBody>[0], 'hideHint' | 'closeHint' | 'tabActivity'> & {
  reviewQueue?: ChatReviewQueue
}

export function ChatLayoutPaneHeader(props: ChatLayoutPaneHeaderProps) {
  const { reviewQueue, activity, tabs, activeId, ...rest } = props
  if (reviewQueue) {
    return <ChatLayoutPaneHints tabs={tabs} activeId={activeId} reviewQueue={reviewQueue}>
      {(hints) => <ChatLayoutPaneHeaderBody {...rest} tabs={tabs} activeId={activeId} reviewQueue={reviewQueue}
        activity={activity} hideHint={hints.hideHint} closeHint={hints.closeHint} tabActivity={hints.tabActivity} />}
    </ChatLayoutPaneHints>
  }
  return <ChatLayoutPaneHeaderBody {...rest} tabs={tabs} activeId={activeId} activity={activity}
    hideHint={paneHideHint(tabs.map((id) => activity?.(id)?.state))}
    closeHint={tabCloseHint(activity?.(activeId)?.state)}
    tabActivity={activity?.(activeId)} />
}
