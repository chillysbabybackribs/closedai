import type { JSX } from 'react'
import { Check, Square, Trash2, X } from 'lucide-react'
import type { ChatController } from '../chat-controller.js'
import type { DrawerController } from './drawer-controller.js'
import type { DrawerRowModel } from './drawer-types.js'

export function DrawerRowActions({
  row,
  controller,
  chat
}: {
  row: DrawerRowModel
  controller: DrawerController
  chat: ChatController
}): JSX.Element {
  const isConfirming = controller.pendingDeleteId === row.id

  // Stop the row's own pane. Interrupting "the chat" stopped whichever pane was selected, so the
  // stop button on a background row killed the turn the user was watching instead.
  if (row.running) {
    return (
      <div className="agents-row-actions">
        <button
          type="button"
          onClick={() => {
            const stop = row.paneId ? chat.interruptPane(row.paneId) : chat.interrupt()
            stop.catch(controller.reportError)
          }}
          title="Stop agent"
          aria-label={`Stop agent: ${row.title}`}
          data-ui="drawer.row-stop"
          data-ui-key={row.id}
        >
          <Square size={13} />
        </button>
      </div>
    )
  }

  // An attached chat closes without ceremony: its record stays in History and reopens from there.
  // Only detached rows delete (archive) the chat itself, which is what the confirmation guards.
  if (row.paneId !== undefined) {
    return (
      <div className="agents-row-actions">
        <button
          type="button"
          onClick={() => void controller.deleteRow(row.id, true)}
          title="Close chat (keeps it in History)"
          aria-label={`Close ${row.title}`}
          data-ui="drawer.row-close"
          data-ui-key={row.id}
        >
          <X size={13} />
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
            onClick={() => void controller.deleteRow(row.id, false)}
            title="Confirm delete"
            aria-label={`Confirm delete ${row.title}`}
            data-ui="drawer.row-delete-confirm"
            data-ui-key={row.id}
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            onClick={() => controller.setPendingDeleteId(null)}
            title="Cancel"
            aria-label="Cancel delete"
            data-ui="drawer.row-delete-cancel"
            data-ui-key={row.id}
          >
            <X size={13} />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => controller.setPendingDeleteId(row.id)}
          title="Delete chat"
          aria-label={`Delete ${row.title}`}
          data-ui="drawer.row-delete"
          data-ui-key={row.id}
        >
          <Trash2 size={13} />
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
