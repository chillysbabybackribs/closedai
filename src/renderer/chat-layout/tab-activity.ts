import type { ChatSnapshot } from '../../shared/chat.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { activitySteps } from '../activity-steps.js'
import { isActivity } from '../transcript-rows.js'
import type { DrawerReviewEntry } from '../side-drawer/drawer-review-queue.js'

export type TabActivity = {
  state: 'idle' | 'working' | 'paused' | 'failed' | 'unread'
  label: string
  detail: string
  steps: { id: string; label: string; phase: string }[]
  startedAt?: number
}

/** Use provider state, never infer waiting or success from the assistant's prose. */
export function tabActivity(row?: ChatRowSummary, snapshot?: ChatSnapshot, review?: DrawerReviewEntry): TabActivity {
  const items = snapshot?.items ?? []
  const start = items.findLastIndex((item) => item.type === 'user')
  const turn = items.slice(Math.max(0, start)).filter((item) =>
    !snapshot?.activeTurnId || item.turnId === snapshot.activeTurnId)
  const running = row?.running ?? Boolean(snapshot?.activeTurnId)
  const paused = !running && Boolean(snapshot?.pausedTurnId)
  const failed = snapshot?.connection.state === 'error' || (!running &&
    turn.some((item) => item.type === 'notice' && item.tone === 'error'))
  const state = paused ? 'paused' : failed ? 'failed' : running ? 'working'
    : review?.viewedAt === null ? 'unread' : 'idle'
  const label = { idle: 'Ready', working: 'Working', paused: 'Paused', failed: 'Needs attention', unread: 'Finished · unread' }[state]
  const steps = activitySteps(turn.filter(isActivity).slice(-3), Date.now()).map((step) => ({
    id: step.id, label: `${step.verb} ${step.label}`.trim().slice(0, 160), phase: step.phase
  }))
  const lastMessage = turn.findLast((item) => item.type === 'assistant')
  const detail = (running ? row?.activity || 'Working on this conversation'
    : paused ? 'Open this chat to resume.'
      : failed ? snapshot?.connection.state === 'error' ? snapshot.connection.message : 'Open this chat to inspect the error.'
        : lastMessage?.type === 'assistant' ? lastMessage.text : row?.preview || 'No recent activity.').slice(0, 240)
  return { state, label, detail, steps,
    startedAt: running ? snapshot?.turnContext?.createdAt : undefined }
}
