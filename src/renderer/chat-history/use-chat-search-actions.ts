import { useRef, useState } from 'react'
import type { HistoryController } from './history-controller.js'
import type { ChatSearchHit } from './history-search.js'

type RowController = Pick<HistoryController, 'openRow' | 'deleteRow' | 'pauseRow' | 'resumeRow' | 'reportError'>

/**
 * Open, delete, and pause/resume for chat-search rows, shared by the title-bar palette and Start's
 * Search chats view. One action runs at a time; `keepFocus` runs before a row control that is about
 * to disappear, so keyboard focus stays in the search field.
 */
export function useChatSearchActions(controller: RowController, { onOpened, keepFocus }: {
  onOpened: () => void
  keepFocus: () => void
}) {
  const actionRef = useRef(false)
  const [opening, setOpening] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [changingTurn, setChangingTurn] = useState<string | null>(null)

  const open = async (hit: ChatSearchHit | undefined): Promise<void> => {
    if (!hit || actionRef.current) return
    actionRef.current = true
    setOpening(true)
    try {
      await controller.openRow(hit.row.paneId)
      onOpened()
    } catch (error) {
      controller.reportError(error)
    } finally {
      actionRef.current = false
      setOpening(false)
    }
  }

  const remove = async (hit: ChatSearchHit): Promise<void> => {
    if (hit.row.running || actionRef.current) return
    actionRef.current = true
    setDeleting(hit.row.paneId)
    keepFocus()
    try {
      await controller.deleteRow(hit.row.paneId)
    } catch (error) {
      controller.reportError(error)
    } finally {
      actionRef.current = false
      setDeleting(null)
    }
  }

  const toggleTurn = async (hit: ChatSearchHit): Promise<void> => {
    if (actionRef.current || (!hit.row.running && !hit.row.paused)) return
    actionRef.current = true
    setChangingTurn(hit.row.paneId)
    keepFocus()
    try {
      if (hit.row.running) await controller.pauseRow(hit.row.paneId)
      else await controller.resumeRow(hit.row.paneId)
    } catch (error) {
      controller.reportError(error)
    } finally {
      actionRef.current = false
      setChangingTurn(null)
    }
  }

  return { open, remove, toggleTurn, changingTurn, busy: opening || deleting !== null || changingTurn !== null }
}
