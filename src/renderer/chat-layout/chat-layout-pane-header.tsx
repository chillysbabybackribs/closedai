import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { ContextMenu } from 'radix-ui'
import { Plus } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import { ChatLayoutContextMenu } from './layout-context-menu.js'
import { ChatLayoutPaneHints } from './chat-layout-pane-hints.js'
import { ChatTabs } from './chat-tabs.js'
import { isViewTabId } from './layout-tree.js'
import { isNoteTab } from '../notepad/notepad-layout.js'
import { WindowControls } from './floating/window-controls.js'
import { paneHideHint, tabCloseHint } from './layout-copy.js'
import type { TabActivity } from './tab-activity.js'

function ChatLayoutPaneHeaderBody({ activeId, tabs, chatCount, busy, toolsPreset, title, activity, reviewQueue, row, soloTile, setSoloPaneId, tabFocus, hideHint, closeHint, tabActivity, onSelect, onSelectTab, onCloseTab, onNewChat, onRenameChat, onTogglePin, onPauseTab, onResumeTab, onOpenPresets, onHide, setDragging, canMaximize, isThisTileSolo, canMinimize, onMinimize, onTile, onTop, onKeepOnTop }: {
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
  onSelect: (id: string) => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewChat: (id: string) => void
  onRenameChat?: (id: string) => void
  onTogglePin?: (id: string, pinned: boolean) => void
  onPauseTab?: (id: string) => void
  onResumeTab?: (id: string) => void
  onOpenPresets?: () => void
  onHide: (id: string) => void
  setDragging: (value: { id: string; singleTab: boolean } | null) => void
  canMaximize: boolean
  isThisTileSolo: boolean
  canMinimize: boolean
  onMinimize: (id: string) => void
  /** Only while the window floats: put it back into its slot of the tiled layout. */
  onTile?: () => void
  onTop: boolean
  onKeepOnTop: (id: string, onTop: boolean) => void
}) {
  // A view in front has no chat actions: rename, pin, pause belong to the chat it follows, not the tab.
  const view = isViewTabId(activeId)
  const noteTile = isNoteTab(activeId)
  const newTabButton = (className: string) => (
    <button type="button" className={className}
      data-ui="layout.new-chat" data-ui-key={activeId} disabled={busy}
      title={noteTile ? 'New note tab' : 'New chat tab'} aria-label={noteTile ? 'New note tab' : 'New chat tab'}
      onClick={() => onNewChat(activeId)}>
      <Plus size={14} aria-hidden="true" />
    </button>
  )
  return <ContextMenu.Root>
    <ContextMenu.Trigger asChild>
      <header className="chat-layout-header"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) onSelect(activeId)
        }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
          if (onTile && !isThisTileSolo) onTile()
          else if (canMaximize || isThisTileSolo) setSoloPaneId((current) => current ? null : activeId)
        }}>
        {/* The canvas moves the window from a press here or on the header's empty space. */}
        <button type="button" className="chat-layout-drag" data-ui="layout.pane-drag" data-ui-key={activeId}
          data-window-grip="" disabled={busy} aria-label="Move window"
          title="Drag to move the window: to a workspace edge to tile it, onto a tab strip to join its tabs · Tab drags move one conversation">
          <span className="chat-layout-drag-dots" aria-hidden="true" />
        </button>
        <ChatTabs ids={tabs} activeId={activeId} busy={busy} canClose={tabs.length > 1 || chatCount > 1}
          title={title} activity={activity} reviewQueue={reviewQueue}
          onSelect={(tab) => { tabFocus.current = tab; onSelectTab(tab) }} onClose={onCloseTab}
          onDrag={(tab) => setDragging({ id: tab, singleTab: true })} trailing={noteTile ? newTabButton('chat-layout-tab-new') : undefined} />
        {toolsPreset === 'read-only' && <span className="chat-layout-preset" data-ui="layout.tools-preset"
          title="Tools are in Read-only: the model can look but not act. Change it in Agent → Tools & capabilities.">Read-only</span>}
        {!noteTile && newTabButton('chat-layout-new-chat')}
        <WindowControls id={activeId} busy={busy} maximized={isThisTileSolo} floating={Boolean(onTile)} canMinimize={canMinimize}
          canMaximize={canMaximize} closeLabel={`Close window · ${hideHint}`} canClose={chatCount >= 2}
          onMinimize={() => {
            if (soloTile) setSoloPaneId(null)
            onMinimize(activeId)
          }}
          onToggleMaximize={() => setSoloPaneId((current) => current ? null : activeId)}
          onClose={() => {
            if (soloTile) setSoloPaneId(null)
            onHide(activeId)
          }} />
      </header>
    </ContextMenu.Trigger>
    <ChatLayoutContextMenu activeId={activeId} tabs={tabs} chatCount={chatCount} busy={busy}
      hideHint={hideHint} closeHint={closeHint} tabActivity={tabActivity}
      pinned={row?.pinnedAt != null} onTop={onTop} onToggleOnTop={() => onKeepOnTop(activeId, !onTop)}
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
