import { useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ContextMenu } from 'radix-ui'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import { chatContextMenuCollisionBoundary } from '../chat-context-menu-boundary.js'
import { selectedText } from '../chat-clipboard-actions.js'
import type { ChatZoomCommand } from '../chat-zoom.js'
import { ChatLayoutPaneHints } from './chat-layout-pane-hints.js'
import { paneHideHint, tabCloseHint } from './layout-copy.js'
import { ChatLayoutContextMenu } from './layout-context-menu.js'
import { isViewTabId } from './layout-tree.js'
import type { TabActivity } from './tab-activity.js'

type ChatTileContextMenuBodyProps = {
  children: ReactNode
  activeId: string
  tabs: string[]
  chatCount: number
  busy: boolean
  hideHint: string
  closeHint: string
  tabActivity?: TabActivity
  pinned: boolean
  onTop: boolean
  onToggleOnTop: () => void
  onOpenPresets?: () => void
  onRename?: () => void
  onTogglePin?: () => void
  onPause?: () => void
  onResume?: () => void
  onCloseTab: () => void
  onHide: () => void
  chatZoom: number
  onChatZoomChange: (command: ChatZoomCommand) => void
}

function ChatTileContextMenuBody({ children, ...menu }: ChatTileContextMenuBodyProps): ReactNode {
  const triggerRef = useRef<HTMLDivElement>(null)
  const [copyEnabled, setCopyEnabled] = useState(false)
  const [collisionBoundary, setCollisionBoundary] = useState<Element | null>(null)
  const { activeId, tabs, chatCount, busy, hideHint, closeHint, tabActivity, pinned, onTop, onToggleOnTop,
    onOpenPresets, onRename, onTogglePin, onPause, onResume, onCloseTab, onHide, chatZoom, onChatZoomChange } = menu
  return <ContextMenu.Root onOpenChange={(open) => {
    if (open) {
      setCopyEnabled(Boolean(selectedText()))
      setCollisionBoundary(chatContextMenuCollisionBoundary(triggerRef.current))
    }
  }}>
    <ContextMenu.Trigger asChild ref={triggerRef}>{children}</ContextMenu.Trigger>
    <ChatLayoutContextMenu activeId={activeId} tabs={tabs} chatCount={chatCount} busy={busy}
      hideHint={hideHint} closeHint={closeHint} tabActivity={tabActivity} pinned={pinned}
      onTop={onTop} onToggleOnTop={onToggleOnTop} onOpenPresets={onOpenPresets} onRename={onRename}
      onTogglePin={onTogglePin} onPause={onPause} onResume={onResume} onCloseTab={onCloseTab} onHide={onHide}
      chatZoom={chatZoom} copyEnabled={copyEnabled} onChatZoomChange={onChatZoomChange}
      collisionBoundary={collisionBoundary} />
  </ContextMenu.Root>
}

export function ChatTileContextMenu({ children, activeId, tabs, chatCount, busy, activity, reviewQueue, row,
  soloTile, setSoloPaneId, onOpenPresets, onRenameChat, onTogglePin, onPauseTab, onResumeTab, onCloseTab, onHide,
  onTop, onToggleOnTop, chatZoom, onChatZoomChange
}: {
  children: ReactNode
  activeId: string
  tabs: string[]
  chatCount: number
  busy: boolean
  activity?: (id: string) => TabActivity
  reviewQueue?: ChatReviewQueue
  row: ChatRowSummary | undefined
  soloTile: { id: string; tabs: string[] } | null
  setSoloPaneId: Dispatch<SetStateAction<string | null>>
  onOpenPresets?: () => void
  onRenameChat?: (id: string) => void
  onTogglePin?: (id: string, pinned: boolean) => void
  onPauseTab?: (id: string) => void
  onResumeTab?: (id: string) => void
  onCloseTab: (id: string) => void
  onHide: (id: string) => void
  onTop: boolean
  onToggleOnTop: () => void
  chatZoom: number
  onChatZoomChange: (command: ChatZoomCommand) => void
}): ReactNode {
  const view = isViewTabId(activeId)
  const pinned = row?.pinnedAt != null
  const shared = {
    activeId,
    tabs,
    chatCount,
    busy,
    pinned,
    onTop,
    onToggleOnTop,
    chatZoom,
    onChatZoomChange,
    onOpenPresets: onOpenPresets ? () => { if (soloTile) setSoloPaneId(null); onOpenPresets() } : undefined,
    onRename: onRenameChat && !view ? () => onRenameChat(activeId) : undefined,
    onTogglePin: onTogglePin && !view ? () => onTogglePin(activeId, !pinned) : undefined,
    onPause: onPauseTab && !view ? () => onPauseTab(activeId) : undefined,
    onResume: onResumeTab && !view ? () => onResumeTab(activeId) : undefined,
    onCloseTab: () => { if (soloTile) setSoloPaneId(null); onCloseTab(activeId) },
    onHide: () => { if (soloTile) setSoloPaneId(null); onHide(activeId) }
  }
  if (reviewQueue) {
    return <ChatLayoutPaneHints tabs={tabs} activeId={activeId} reviewQueue={reviewQueue}>
      {(hints) => <ChatTileContextMenuBody {...shared} hideHint={hints.hideHint} closeHint={hints.closeHint}
        tabActivity={hints.tabActivity}>{children}</ChatTileContextMenuBody>}
    </ChatLayoutPaneHints>
  }
  return <ChatTileContextMenuBody {...shared}
    hideHint={paneHideHint(tabs.map((id) => activity?.(id)?.state))}
    closeHint={tabCloseHint(activity?.(activeId)?.state)}
    tabActivity={activity?.(activeId)}>{children}</ChatTileContextMenuBody>
}
