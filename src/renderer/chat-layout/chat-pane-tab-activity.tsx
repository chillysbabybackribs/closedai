import { useRef, useSyncExternalStore } from 'react'
import { CircleAlert, LoaderCircle, Pause } from 'lucide-react'
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

/** Tab header indicator; subscribes to one pane so other panes streaming do not rerender this tab. */
export function ChatPaneTabActivity({ paneId, reviewQueue }: { paneId: string; reviewQueue: ChatReviewQueue }) {
  const cached = useRef<{ pane: TabActivity; paneState: unknown }>()
  const status = useSyncExternalStore(
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
  if (status.state === 'idle') return null
  return <span className="chat-tab-indicator" aria-hidden="true">
    {status.state === 'working' ? <LoaderCircle className="chat-tab-spinner" size={16} />
      : status.state === 'paused' ? <Pause size={16} />
        : status.state === 'failed' ? <CircleAlert size={16} />
          : <i className="chat-tab-unread" />}
  </span>
}

export function usePaneTabActivity(paneId: string, reviewQueue: ChatReviewQueue): TabActivity {
  const cached = useRef<{ pane: TabActivity; paneState: unknown }>()
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
  const cached = useRef<{ key: string; paneStates: unknown[]; activities: TabActivity[] }>()
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
