import { useRef, useSyncExternalStore } from 'react'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import { getWorkspaceSnapshot, paneChatSnapshot, subscribeWorkspaceSnapshot } from './workspace-snapshot-store.js'
import { tabActivity } from './tab-activity.js'
import type { TabActivity } from './tab-activity.js'

export function readPaneTabActivity(paneId: string, reviewQueue: ChatReviewQueue): TabActivity {
  const workspace = getWorkspaceSnapshot()
  const row = workspace.chats.find((entry) => entry.paneId === paneId)
  const pane = paneChatSnapshot(workspace, paneId)
  return tabActivity(row, pane, reviewQueue[paneId])
}

export function usePaneTabActivity(paneId: string, reviewQueue: ChatReviewQueue): TabActivity {
  const cached = useRef<{ pane: TabActivity; paneState: unknown } | undefined>(undefined)
  return useSyncExternalStore(
    subscribeWorkspaceSnapshot,
    () => {
      const workspace = getWorkspaceSnapshot()
      const paneState = paneChatSnapshot(workspace, paneId)
      const next = readPaneTabActivity(paneId, reviewQueue)
      const previous = cached.current
      if (previous && previous.paneState === paneState && previous.pane.label === next.label && previous.pane.state === next.state) {
        return previous.pane
      }
      cached.current = { pane: next, paneState }
      return next
    },
    () => readPaneTabActivity(paneId, reviewQueue)
  )
}

export function usePaneTabActivityStrip(tabIds: readonly string[], reviewQueue: ChatReviewQueue): TabActivity[] {
  const cached = useRef<{ key: string; paneStates: unknown[]; activities: TabActivity[] } | undefined>(undefined)
  return useSyncExternalStore(
    subscribeWorkspaceSnapshot,
    () => {
      const workspace = getWorkspaceSnapshot()
      const paneStates = tabIds.map((id) => paneChatSnapshot(workspace, id))
      const activities = tabIds.map((id) => readPaneTabActivity(id, reviewQueue))
      const key = tabIds.join('\0')
      const previous = cached.current
      if (previous && previous.key === key && paneStates.every((state, index) => state === previous.paneStates[index])) {
        return previous.activities
      }
      cached.current = { key, paneStates, activities }
      return activities
    },
    () => tabIds.map((id) => readPaneTabActivity(id, reviewQueue))
  )
}
