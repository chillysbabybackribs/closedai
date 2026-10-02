import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import { ContextMenu } from 'radix-ui'
import { Plus, Star } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import { HeaderChatSearch } from '../chat-history/header-search.js'
import type { HistoryController } from '../chat-history/history-controller.js'
import { ChatLayoutContextMenu } from './layout-context-menu.js'
import { ChatLayoutPaneHints } from './chat-layout-pane-hints.js'
import { ChatTabs } from './chat-tabs.js'
import { isViewTabId } from './layout-tree.js'
import { isNoteTab } from '../notepad/notepad-layout.js'
import { WindowControls } from './floating/window-controls.js'
import { paneHideHint, tabCloseHint } from './layout-copy.js'
import type { TabActivity } from './tab-activity.js'

function ChatLayoutPaneHeaderBody({ activeId, tabs, chatCount, busy, toolsPreset, title, activity, reviewQueue, row, soloTile, setSoloPaneId, tabFocus, hideHint, closeHint, tabActivity, workspaceSelectedId, threadSearch, onSelect, onSelectTab, onCloseTab, onNewChat, onRenameChat, onTogglePin, onPauseTab, onResumeTab, onOpenPresets, onHide, setDragging, canMaximize, isThisTileSolo, canMinimize, onMinimize, onTile, onTop, onKeepOnTop }: {
  activeId: string
  workspaceSelectedId?: string | null
  threadSearch?: {
    chats: ChatRowSummary[]
    controller: HistoryController
    inputRef: RefObject<HTMLInputElement | null>
  }
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
  const pinned = row?.pinnedAt != null
  // + adds the window's own kind: a chat to chats, a note to notes. Other views have nothing to add.
  const newTabButton = (className: string) => (
    <button type="button" className={className}
      data-ui="layout.new-chat" data-ui-key={activeId} disabled={busy}
      title={noteTile ? 'New note tab' : 'New chat tab'} aria-label={noteTile ? 'New note tab' : 'New chat tab'}
      onClick={() => onNewChat(activeId)}>
      <Plus size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  )
  return <ContextMenu.Root>
    <ContextMenu.Trigger asChild>
      <header className={`chat-layout-header${view ? '' : ' chat-card-header'}`}
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) onSelect(activeId)
        }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
          if (onTile && !isThisTileSolo) onTile()
          else if (canMaximize || isThisTileSolo) setSoloPaneId((current) => current ? null : activeId)
        }}>
        {/* The canvas moves the window from a press here or on the header's empty space. */}
        {view && <button type="button" className="chat-layout-drag" data-ui="layout.pane-drag" data-ui-key={activeId}
          data-window-grip="" disabled={busy} aria-label="Move window"
          title="Drag to move the window">
          <span className="chat-layout-drag-dots" aria-hidden="true" />
        </button>}
        {view ? <ChatTabs ids={tabs} activeId={activeId} busy={busy} canClose={tabs.length > 1 || chatCount > 1}
          title={title} activity={activity} reviewQueue={reviewQueue} variant={noteTile ? 'note' : 'default'}
          onSelect={(tab) => { tabFocus.current = tab; onSelectTab(tab) }} onClose={onCloseTab}
          onDrag={(tab) => setDragging({ id: tab, singleTab: true })} trailing={view && !noteTile ? undefined : newTabButton('chat-layout-tab-new')} /> : <>
          {onTogglePin && <button type="button" className="chat-card-pin" data-ui="layout.card-pin" data-ui-key={activeId}
            aria-pressed={pinned} title={pinned ? 'Unpin chat' : 'Pin chat'} aria-label={pinned ? 'Unpin chat' : 'Pin chat'}
            onClick={() => onTogglePin(activeId, !pinned)}>
            <Star size={17} strokeWidth={1.6} aria-hidden="true" />
          </button>}
          {threadSearch && <div className="chat-card-thread-search">
            <HeaderChatSearch chats={threadSearch.chats} controller={threadSearch.controller}
              inputRef={activeId === workspaceSelectedId ? threadSearch.inputRef : undefined}
              paneKey={activeId} variant="card" />
          </div>}
        </>}
        {toolsPreset === 'read-only' && <span className="chat-layout-preset" data-ui="layout.tools-preset"
          title="Tools are in Read-only: the model can look but not act. Change it in Agent → Tools & capabilities.">Read-only</span>}
        {!view && <div className="chat-card-model" id={`chat-model-${activeId}`} />}
        {view && <WindowControls id={activeId} busy={busy} maximized={isThisTileSolo} floating={Boolean(onTile)} canMinimize={canMinimize}
          canMaximize={canMaximize} closeLabel={`Close window · ${hideHint}`} canClose
          onMinimize={() => {
            if (soloTile) setSoloPaneId(null)
            onMinimize(activeId)
          }}
          onToggleMaximize={() => setSoloPaneId((current) => current ? null : activeId)}
          onClose={() => {
            if (soloTile) setSoloPaneId(null)
            onHide(activeId)
          }} />}
      </header>
    </ContextMenu.Trigger>
    <ChatLayoutContextMenu activeId={activeId} tabs={tabs} chatCount={chatCount} busy={busy}
      hideHint={hideHint} closeHint={closeHint} tabActivity={tabActivity}
      pinned={pinned} onTop={onTop} onToggleOnTop={() => onKeepOnTop(activeId, !onTop)}
      onOpenPresets={onOpenPresets ? () => { if (soloTile) setSoloPaneId(null); onOpenPresets() } : undefined}
      onRename={onRenameChat && !view ? () => onRenameChat(activeId) : undefined}
      onTogglePin={onTogglePin && !view ? () => onTogglePin(activeId, !pinned) : undefined}
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
