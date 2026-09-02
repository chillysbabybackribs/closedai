import type { JSX } from 'react'
import { Check, Square, Trash2, X } from 'lucide-react'
import type { ChatController } from '../chat-controller.js'
import type { DrawerController } from './drawer-controller.js'
import type { DrawerRowModel } from './drawer-types.js'

export function DrawerRowActions({
  row,
  controller,
  chat,
  awaitingReview = false
}: {
  row: DrawerRowModel
  controller: DrawerController
  chat: ChatController
  awaitingReview?: boolean
}): JSX.Element {
  const isConfirming = controller.pendingDeleteId === row.id

  if (awaitingReview) {
    return (
      <div className="agents-row-actions is-review">
        <button
          type="button"
          onClick={() => controller.acceptReview(row.id)}
          title="Accept — mark reviewed"
          aria-label={`Accept review: ${row.title}`}
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          onClick={() => controller.dismissReview(row.id)}
          title="Dismiss from review queue"
          aria-label={`Dismiss review: ${row.title}`}
        >
          <X size={12} />
        </button>
      </div>
    )
  }

  if (row.running) {
    return (
      <div className="agents-row-actions">
        <button
          type="button"
          onClick={() => void chat.interrupt()}
          title="Stop agent"
          aria-label={`Stop agent: ${row.title}`}
        >
          <Square size={12} />
        </button>
      </div>
    )
  }

  return (
    <div className="agents-row-actions">
      {isConfirming ? (
        <>
          <button
            type="button"
            onClick={() => void controller.deleteRow(row.id, row.threadId, row.paneId)}
            title="Confirm delete"
            aria-label={`Confirm delete ${row.title}`}
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            onClick={() => controller.setPendingDeleteId(null)}
            title="Cancel"
            aria-label="Cancel delete"
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => controller.setPendingDeleteId(row.id)}
          title="Delete chat"
          aria-label={`Delete ${row.title}`}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}

export function DiffBadge({ added, removed }: { added: number; removed: number }): JSX.Element | null {
  if (added === 0 && removed === 0) return null
  return (
    <span className="agents-row-diff" title={`${added} lines added, ${removed} lines removed`}>
      {added > 0 ? <span className="agents-diff-add">+{added}</span> : null}
      {removed > 0 ? <span className="agents-diff-remove">−{removed}</span> : null}
    </span>
  )
}
