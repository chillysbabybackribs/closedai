import type { ReactNode } from 'react'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import { paneHideHint, tabCloseHint } from './layout-copy.js'
import { usePaneTabActivityStrip } from './chat-pane-tab-activity.js'
import type { TabActivity } from './tab-activity.js'

export function ChatLayoutPaneHints({ tabs, activeId, reviewQueue, children }: {
  tabs: string[]
  activeId: string
  reviewQueue: ChatReviewQueue
  children: (hints: { hideHint: string; closeHint: string; tabActivity: TabActivity }) => ReactNode
}) {
  const activities = usePaneTabActivityStrip(tabs, reviewQueue)
  const hideHint = paneHideHint(activities.map((activity) => activity.state))
  const activeIndex = Math.max(0, tabs.indexOf(activeId))
  const tabActivity = activities[activeIndex] ?? activities[0]!
  const closeHint = tabCloseHint(tabActivity.state)
  return children({ hideHint, closeHint, tabActivity })
}
