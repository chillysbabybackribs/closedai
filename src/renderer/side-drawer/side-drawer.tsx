import type { JSX } from 'react'
import { memo, useMemo, useState } from 'react'
import type { ChatController } from '../chat-controller.js'
import type { DrawerController } from './drawer-controller.js'
import { useCollapsedDirectories, useCollapsedParents, useExpandedDirectoryHistory, useExpandedSettled } from './drawer-fold-state.js'
import { DrawerHeader } from './drawer-header.js'
import { DrawerDirectory } from './drawer-directory.js'
import type { FoldState } from './drawer-row.js'
import { DrawerRowMenu, type RowMenuTarget } from './drawer-row-menu.js'
import { groupByDirectory } from './drawer-sections.js'

function SideDrawerView({ controller, chat, onSplitChat }: {
  controller: DrawerController
  chat: ChatController
  onSplitChat: (chatId: string, edge: 'right' | 'bottom') => Promise<void>
}): JSX.Element | null {
  const [collapsedParents, onToggleParent] = useCollapsedParents()
  const [expandedSettled, onToggleSettled] = useExpandedSettled()
  const [collapsedDirectories, toggleDirectory] = useCollapsedDirectories()
  const [expandedHistory, toggleHistory] = useExpandedDirectoryHistory()
  const [rowMenu, setRowMenu] = useState<RowMenuTarget | null>(null)
  const directories = useMemo(() => groupByDirectory(controller.rows), [controller.rows])
  const fold: FoldState = { collapsedParents, onToggleParent, expandedSettled, onToggleSettled }
  const cwd = chat.workspace?.cwd ?? chat.state.cwd
  if (controller.isCollapsed) return null

  return <aside className="agents-pane" aria-label="Side drawer" data-ui-surface="side-drawer">
    <DrawerHeader controller={controller} />
    <div className="agents-list">
      {directories.map((group) => <DrawerDirectory key={group.key} group={group}
        collapsed={collapsedDirectories.has(group.key)} onToggle={() => toggleDirectory(group.key)}
        historyOpen={expandedHistory.has(group.key)} onToggleHistory={() => toggleHistory(group.key)}
        controller={controller} chat={chat} fold={fold} onRowMenu={setRowMenu} />)}
      {directories.length === 0 && <p className="agents-empty">Chats and background agents appear here.</p>}
    </div>
    <div className="agents-instance-footer">
      {controller.error ? <span className="agents-footer-error" role="alert" title={controller.error}>
        {controller.error}
      </span> : <span className="agents-instance-label">ClosedAI <span className="agents-instance-num">1</span></span>}
    </div>
    {rowMenu && <DrawerRowMenu target={rowMenu}
      inheritedModel={rowMenu.modelId ?? chat.state.selectedModel} models={chat.state.models}
      onClose={() => setRowMenu(null)}
      canSplit={rowMenu.id !== chat.selectedPaneId && chat.chats.find((row) => row.paneId === rowMenu.id)?.cwd === cwd}
      onSplit={(edge) => {
        setRowMenu(null)
        onSplitChat(rowMenu.id, edge).catch(controller.reportError)
      }}
      onTogglePin={() => {
        setRowMenu(null)
        chat.setChatPinned(rowMenu.id, !rowMenu.pinned).catch(controller.reportError)
      }}
      onFork={(modelId) => {
        setRowMenu(null)
        chat.openChat(rowMenu.id).then(() => chat.continueFromChat(
          { paneId: rowMenu.id, threadId: rowMenu.threadId }, modelId
        )).catch(controller.reportError)
      }} />}
  </aside>
}

export const SideDrawer = memo(SideDrawerView)
