import { useRef, useState } from 'react'
import { scheduleComposerFocus } from '../chat-clipboard-actions.js'
import type { HistoryController } from './history-controller.js'
import type { ChatSearchHit } from './history-search.js'

type RowController = Pick<HistoryController, 'openRow' | 'deleteRow' | 'reportError'>

/**
 * Open and archive for header chat search rows. One action runs at a time; `keepFocus` runs before
 * a row control that is about to disappear, so keyboard focus stays in the search field.
 */
export function useChatSearchActions(controller: RowController, { onOpened, keepFocus }: {
  onOpened: () => void
  keepFocus: () => void
}) {
  const actionRef = useRef(false)
  const [opening, setOpening] = useState(false)
  const [archiving, setArchiving] = useState<string | null>(null)

  const open = async (hit: ChatSearchHit | undefined): Promise<void> => {
    if (!hit || actionRef.current) return
    actionRef.current = true
    setOpening(true)
    try {
      const chatId = hit.row.paneId
      await controller.openRow(chatId)
      onOpened()
      scheduleComposerFocus(chatId)
    } catch (error) {
      controller.reportError(error)
    } finally {
      actionRef.current = false
      setOpening(false)
    }
  }

  const archive = async (hit: ChatSearchHit): Promise<void> => {
    if (hit.row.running || actionRef.current) return
    actionRef.current = true
    setArchiving(hit.row.paneId)
    keepFocus()
    try {
      await controller.deleteRow(hit.row.paneId)
    } catch (error) {
      controller.reportError(error)
    } finally {
      actionRef.current = false
      setArchiving(null)
    }
  }

  return { open, archive, archiving, busy: opening || archiving !== null }
}
