import type { JSX, MouseEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ProviderMark } from '../../components/ui/provider-mark.js'
import type { ChatController } from '../chat-controller.js'
import { formatChatTime, formatMessageCount } from './drawer-format.js'
import type { DrawerController } from './drawer-controller.js'
import { DrawerRowActions, DiffBadge } from './drawer-row-actions.js'
import type { RowMenuTarget } from './drawer-row-menu.js'
import { rowMenuAnchor } from './drawer-row-position.js'
import { splitChildren } from './drawer-sections.js'
import type { DrawerRowModel } from './drawer-types.js'

export type FoldState = {
  collapsedParents: ReadonlySet<string>
  onToggleParent: (id: string) => void
  expandedSettled: ReadonlySet<string>
  onToggleSettled: (id: string) => void
}

type RowProps = {
  row: DrawerRowModel
  activeChatId: string | null
  fold: FoldState
  controller: DrawerController
  chat: ChatController
  onRowMenu: (target: RowMenuTarget) => void
  awaitingReview?: boolean
}

export function DrawerRow({
  row,
  activeChatId,
  fold,
  controller,
  chat,
  onRowMenu,
  awaitingReview = false
}: RowProps): JSX.Element {
  const isCurrent = row.threadId === activeChatId || (row.paneId !== undefined && row.paneId === chat.selectedPaneId)
  const isLive = row.running || row.status === 'running' || row.status === 'queued'
  const dot = isLive ? (row.status === 'queued' ? 'queued' : 'running') : (row.status === 'done' ? 'done' : row.status === 'failed' ? 'failed' : 'chat')
  const expanded = row.children.length > 0 && !fold.collapsedParents.has(row.id)

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const anchor = rowMenuAnchor(event.currentTarget.getBoundingClientRect())
    onRowMenu({
      id: row.id,
      title: row.title,
      x: anchor.x,
      y: anchor.y
    })
  }

  const handleOpen = (): void => {
    if (row.paneId && row.paneId !== chat.selectedPaneId) {
      void chat.selectPane(row.paneId)
    } else if (row.threadId) {
      void chat.openThread(row.threadId)
    }
  }

  return (
    <>
      <div
        className={`agents-row ${isCurrent ? 'is-current' : ''}`}
        role="listitem"
        onContextMenu={handleContextMenu}
      >
        <DrawerRowTwisty row={row} expanded={expanded} onToggle={fold.onToggleParent} />
        <button
          type="button"
          className="agents-row-main"
          onClick={handleOpen}
          title={row.completedUnviewed ? 'Finished — open to review' : 'Open this chat'}
          aria-current={isCurrent ? 'true' : undefined}
        >
          {dot === 'running' ? (
            <span className="agents-status-spinner" aria-hidden="true" />
          ) : (
            <span className={`agents-status-dot is-${dot}`} aria-hidden="true" />
          )}
          <span className="agents-row-body">
            <span className="agents-row-task">
              {/* Only live panes carry a provider; history rows are thread records, so they get
                  no mark and the absence itself reads as "not a running chat". */}
              {row.peer && <ProviderMark provider={row.peer.provider} className="agents-row-provider" />}
              {row.title}
            </span>
            <span className="agents-row-meta">
              <span className="agents-row-meta-text">{buildRowMeta(row)}</span>
              <DiffBadge added={row.linesAdded} removed={row.linesRemoved} />
            </span>
          </span>
        </button>
        <DrawerRowActions
          row={row}
          controller={controller}
          chat={chat}
          awaitingReview={awaitingReview}
        />
      </div>
      {expanded ? (
        <DrawerSubtree
          row={row}
          activeChatId={activeChatId}
          fold={fold}
          controller={controller}
          chat={chat}
          onRowMenu={onRowMenu}
        />
      ) : null}
    </>
  )
}

function buildRowMeta(row: DrawerRowModel): string {
  const time = formatChatTime(row.updatedAt)
  if (row.running) return `Running · ${time}`
  if (row.status === 'done') return `Done · ${time}`
  if (row.status === 'failed') return `Failed · ${time}`
  if (row.status === 'queued') return `Queued · ${time}`
  const count = formatMessageCount(row.messageCount)
  return count ? `${time} · ${count}` : time
}

function DrawerSubtree({
  row,
  activeChatId,
  fold,
  controller,
  chat,
  onRowMenu
}: RowProps): JSX.Element {
  const { live, settled } = splitChildren(row)
  const settledOpen = fold.expandedSettled.has(row.id)

  const renderChild = (child: DrawerRowModel): JSX.Element => (
    <DrawerRow
      key={child.id}
      row={child}
      activeChatId={activeChatId}
      fold={fold}
      controller={controller}
      chat={chat}
      onRowMenu={onRowMenu}
    />
  )

  return (
    <div className="agents-children" role="group" aria-label={`Sub-agents of ${row.title}`}>
      {live.map(renderChild)}
      {settled.length > 0 ? (
        <button
          type="button"
          className="agents-settled-toggle"
          onClick={() => fold.onToggleSettled(row.id)}
          aria-expanded={settledOpen}
          aria-label={`${settledOpen ? 'Hide' : 'Show'} ${settled.length} settled sub-agents of ${row.title}`}
        >
          {settledOpen ? <ChevronDown size={10} aria-hidden="true" /> : <ChevronRight size={10} aria-hidden="true" />}
          <span>{settled.length} done</span>
        </button>
      ) : null}
      {settledOpen ? settled.map(renderChild) : null}
    </div>
  )
}

function DrawerRowTwisty({
  row,
  expanded,
  onToggle
}: {
  row: DrawerRowModel
  expanded: boolean
  onToggle: (id: string) => void
}): JSX.Element {
  if (row.children.length === 0) return <span className="agents-row-twisty-spacer" aria-hidden="true" />
  return (
    <button
      type="button"
      className="agents-row-twisty"
      onClick={() => onToggle(row.id)}
      aria-expanded={expanded}
      title={expanded ? 'Hide sub-agents' : `Show ${row.children.length} sub-agents`}
      aria-label={`${expanded ? 'Hide' : 'Show'} ${row.children.length} sub-agents of ${row.title}`}
    >
      {expanded ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
      {expanded ? null : <span className="agents-twisty-count">{row.children.length}</span>}
    </button>
  )
}
