import { ChevronDown, ChevronRight, FolderOpen, Pin } from 'lucide-react'
import type { ChatController } from '../chat-controller.js'
import type { DrawerController } from './drawer-controller.js'
import { DrawerRow, type FoldState } from './drawer-row.js'
import type { RowMenuTarget } from './drawer-row-menu.js'
import { buildDrawerSections, countLiveRows } from './drawer-sections.js'
import type { DirectoryGroup, DrawerRowModel } from './drawer-types.js'

export function DrawerDirectory({ group, collapsed, onToggle, historyOpen, onToggleHistory, controller, chat, fold, onRowMenu }: {
  group: DirectoryGroup
  collapsed: boolean
  onToggle: () => void
  historyOpen: boolean
  onToggleHistory: () => void
  controller: DrawerController
  chat: ChatController
  fold: FoldState
  onRowMenu: (target: RowMenuTarget) => void
}) {
  const sections = buildDrawerSections(group.rows, controller.reviewQueue)
  const running = countLiveRows(group.rows)
  const active = group.fullPath === (chat.workspace?.cwd ?? chat.state.cwd)
  const renderRows = (rows: DrawerRowModel[], label: string) => <div role="list" aria-label={`${group.label}: ${label}`}>
    {rows.map((row) => <DrawerRow key={row.id} row={row} fold={fold} controller={controller}
      chat={chat} onRowMenu={onRowMenu} unread={controller.reviewQueue[row.id]?.viewedAt === null} />)}
  </div>
  return <section className="agents-directory" aria-label={group.fullPath ?? group.label}>
    <button type="button" className="agents-directory-toggle" data-active={active}
      data-ui="drawer.directory" data-ui-key={group.key} aria-expanded={!collapsed}
      title={group.fullPath ?? group.label} onClick={onToggle}>
      {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      <FolderOpen size={14} aria-hidden="true" />
      <span className="agents-directory-name">{group.label}</span>
      {active && <span className="agents-directory-active">Active</span>}
      {running > 0 && <span className="agents-running-count">{running} running</span>}
    </button>
    {!collapsed && <div className="agents-directory-content">
      <div className="agents-directory-path" title={group.fullPath ?? undefined}>{group.fullPath}</div>
      {sections.pinned.length > 0 && <>
        <div className="agents-section-label"><Pin size={11} /><span>Pinned</span></div>
        {renderRows(sections.pinned, 'Pinned chats')}
      </>}
      {sections.current.length > 0 && <>
        <div className="agents-section-label">Current</div>
        {renderRows(sections.current, 'Current chats')}
      </>}
      {sections.reviewQueue.length > 0 && <>
        <div className="agents-section-label">Recently completed</div>
        {renderRows(sections.reviewQueue, 'Recently completed chats')}
      </>}
      {sections.history.length > 0 && <>
        <button type="button" className="agents-section-toggle" data-ui="drawer.directory-history"
          data-ui-key={group.key} aria-expanded={historyOpen} onClick={onToggleHistory}>
          {historyOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          History <span className="agents-section-count">{sections.history.length}</span>
        </button>
        {historyOpen && renderRows(sections.history, 'Chat history')}
      </>}
    </div>}
  </section>
}
