import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatLayout } from '../chat-layout/layout-tree.js'
import { chatTabIds } from '../chat-layout/layout-tabs.js'
import { useAppWindows } from '../app-windows/app-window-store.js'
import { deskChatIds, sortDeskOpenIds, syncDeskOpenedAt } from './desk-open-order.js'

/**
 * Stable newest-first order for chats currently on the desk. Activity timestamps must not reorder
 * this list while turns finish; only newly appearing tabs across app windows get a fresh slot.
 */
export function useDeskOpenOrder(tree: ChatLayout | null): readonly string[] {
  const [openedAt, setOpenedAt] = useState<Record<string, number>>({})
  const sequenceRef = useRef(0)
  const { self, windows } = useAppWindows()
  const openIds = useMemo(() => deskChatIds(chatTabIds(tree), self.id, windows), [tree, self.id, windows])
  const openKey = openIds.join('\0')

  useEffect(() => {
    setOpenedAt((current) => syncDeskOpenedAt(current, openKey === '' ? [] : openKey.split('\0'), () => ++sequenceRef.current))
  }, [openKey])

  return useMemo(() => sortDeskOpenIds(openIds, openedAt), [openIds, openedAt])
}
