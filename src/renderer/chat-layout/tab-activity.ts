import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { DrawerReviewEntry } from '../side-drawer/drawer-review-queue.js'

export type TabActivity = {
  state: 'idle' | 'working' | 'paused' | 'failed' | 'unread'
  label: string
}

/** Drives the tab's status glyph and accessible name. Use provider state, never infer waiting
 * or success from the assistant's prose. */
export function tabActivity(row?: ChatRowSummary, snapshot?: ChatSnapshot, review?: DrawerReviewEntry): TabActivity {
  const items = snapshot?.items ?? []
  let start = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]?.type === 'user') {
      start = i
      break
    }
  }
  const turn = items.slice(Math.max(0, start)).filter((item) =>
    !snapshot?.activeTurnId || item.turnId === snapshot.activeTurnId)
  const running = row?.running ?? Boolean(snapshot?.activeTurnId)
  const paused = !running && Boolean(snapshot?.pausedTurnId)
  const failed = snapshot?.connection.state === 'error' || (!running &&
    turn.some((item) => item.type === 'notice' && item.tone === 'error'))
  const state = paused ? 'paused' : failed ? 'failed' : running ? 'working'
    : review?.viewedAt === null ? 'unread' : 'idle'
  const label = { idle: 'Ready', working: 'Working', paused: 'Paused', failed: 'Needs attention', unread: 'Finished · unread' }[state]
  return { state, label }
}
