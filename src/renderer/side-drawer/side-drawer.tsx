import type { JSX } from 'react'
import { memo, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'
import type { ChatController } from '../chat-controller.js'
import { useDrawerAgingClock } from './drawer-aging-clock.js'
import type { DrawerController } from './drawer-controller.js'
import { useCollapsedParents, useExpandedSettled } from './drawer-fold-state.js'
import { DrawerHeader } from './drawer-header.js'
import { DrawerRow, type FoldState } from './drawer-row.js'
import { DrawerRowMenu, type RowMenuTarget } from './drawer-row-menu.js'
import { buildDrawerSections, countLiveRows, groupByDirectory } from './drawer-sections.js'
import type { DrawerRowModel } from './drawer-types.js'

function SideDrawerView({
  controller,
  chat
}: {
  controller: DrawerController
  chat: ChatController
}): JSX.Element | null {
  const agingNow = useDrawerAgingClock()
  const [collapsedParents, onToggleParent] = useCollapsedParents()
  const [expandedSettled, onToggleSettled] = useExpandedSettled()
  const [rowMenu, setRowMenu] = useState<RowMenuTarget | null>(null)

  const { running, reviewQueue, recentlyCompleted, completed, history } = useMemo(
    () => buildDrawerSections(controller.rows, controller.reviewQueue, controller.recentlyCompleted, agingNow),
    [controller.rows, controller.reviewQueue, controller.recentlyCompleted, agingNow]
  )

  const liveCount = useMemo(() => countLiveRows(running), [running])
  const activeChatId = chat.state.threadId
  const fold: FoldState = { collapsedParents, onToggleParent, expandedSettled, onToggleSettled }

  if (controller.isCollapsed) return null

  const renderRows = (
    rows: DrawerRowModel[],
    label: string,
    options: { review?: boolean } = {}
  ): JSX.Element => (
    <div role="list" aria-label={label}>
      {groupByDirectory(rows).map((group) => (
        <div className="agents-dir-group" key={group.key}>
          <div className="agents-dir-label" title={group.fullPath ?? undefined}>
            <FolderOpen size={11} aria-hidden="true" />
            <span>{group.label}</span>
          </div>
          {group.rows.map((row) => (
            <DrawerRow
              key={row.id}
              row={row}
              activeChatId={activeChatId}
              fold={fold}
              controller={controller}
              chat={chat}
              onRowMenu={setRowMenu}
              awaitingReview={options.review === true}
            />
          ))}
        </div>
      ))}
    </div>
  )

  const isEmpty =
    running.length === 0 &&
    reviewQueue.length === 0 &&
    recentlyCompleted.length === 0 &&
    completed.length === 0 &&
    history.length === 0

  return (
    <aside
      className="agents-pane"
      aria-label="Side drawer"
      data-ui-surface="side-drawer"
    >
      <DrawerHeader chat={chat} rows={controller.rows} />

      <div className="agents-list">
        {running.length > 0 ? (
          <>
            <div className="agents-section-label">
              <span>Running</span>
              {liveCount > 0 ? <span className="agents-running-count">{liveCount}</span> : null}
            </div>
            {renderRows(running, 'Running agents')}
          </>
        ) : null}

        {reviewQueue.length > 0 ? (
          <>
            <div className="agents-section-label">
              <span>Review Queue</span>
              <span className="agents-running-count">{reviewQueue.length}</span>
            </div>
            {renderRows(reviewQueue, 'Agents awaiting review', { review: true })}
          </>
        ) : null}

        {recentlyCompleted.length > 0 ? (
          <>
            <div className="agents-section-label">Recently completed</div>
            {renderRows(recentlyCompleted, 'Recently completed chats')}
          </>
        ) : null}

        {completed.length > 0 ? (
          <>
            <div className="agents-section-label">Completed</div>
            {renderRows(completed, 'Completed agents')}
          </>
        ) : null}

        {history.length > 0 ? (
          <>
            <button
              type="button"
              className="agents-section-toggle"
              onClick={controller.toggleHistory}
              aria-expanded={controller.isHistoryOpen}
            >
              {controller.isHistoryOpen ? (
                <ChevronDown size={12} aria-hidden="true" />
              ) : (
                <ChevronRight size={12} aria-hidden="true" />
              )}
              <span>History</span>
              <span className="agents-section-count">{history.length}</span>
            </button>
            {controller.isHistoryOpen ? renderRows(history, 'Chat history') : null}
          </>
        ) : null}

        {isEmpty ? (
          <p className="agents-empty">Chats and background agents appear here.</p>
        ) : null}
      </div>

      <div className="agents-instance-footer">
        <span className="agents-instance-label">ClosedAI <span className="agents-instance-num">1</span></span>
      </div>

      {rowMenu ? (
        <DrawerRowMenu
          target={rowMenu}
          inheritedModel={rowMenu.modelId ?? chat.state.selectedModel}
          models={chat.state.models}
          onClose={() => setRowMenu(null)}
          onFork={(modelId) => {
            setRowMenu(null)
            void chat.continueFromChat(
              { paneId: rowMenu.paneId, threadId: rowMenu.threadId },
              modelId
            )
          }}
        />
      ) : null}
    </aside>
  )
}

export const SideDrawer = memo(SideDrawerView)
