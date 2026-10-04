import {
  AGENT_RUN_MAX_FAILURES, AGENT_RUN_REVIEW_REASON, agentRunLimitReached, describeAgentRunRemaining, type AgentRun
} from '../../shared/agent-runs.js'
import { agentRunBrief, type AgentRunBriefLine } from './agent-run-brief.js'

// What the Agents view shows: one card per run, ordered so runs that need the
// user (an approval, a failure pause, a supervised run waiting for review, a finished limit) come
// first. Pure so the rules are testable.

export type DockTileState = 'running' | 'retrying' | 'paused' | 'finished' | 'failed' | 'approval' | 'review'

/** The slice of a chat row the overview reads: whether a turn is live and what it is doing. */
export type DockChatActivity = { paneId: string; running: boolean; activity: string | null }

/** The slice of a pending credential approval the overview reads. */
export type DockApproval = { id: string; paneId: string | null; credentialLabel: string }

export type DockTile = {
  chatId: string
  name: string
  state: DockTileState
  /** The run's own status, which decides Pause versus Resume. */
  running: boolean
  cycleLabel: string
  /** Running time left under the run's time limit ("42 min left"); null without one. */
  timeLabel: string | null
  detail: string
  /** Set while the tile needs the user; changes when the reason changes, so it re-announces. */
  attentionKey: string | null
  /** The sentences under the row: progress, last reply, cost, and errors (agent-run-brief.ts). */
  brief: AgentRunBriefLine[]
}

/** How each state reads in the run card. */
export const DOCK_STATE_LABEL: Record<DockTileState, string> = {
  running: 'Running', retrying: 'Retrying', paused: 'Paused', finished: 'Finished',
  failed: 'Paused by failures', approval: 'Needs your approval', review: 'Waiting for you'
}

const ATTENTION: ReadonlySet<DockTileState> = new Set(['approval', 'failed', 'review', 'finished'])
const ORDER: Record<DockTileState, number> = { approval: 0, failed: 1, review: 2, finished: 3, retrying: 4, running: 5, paused: 6 }

export function dockTileState(run: AgentRun, approvals: number): DockTileState {
  if (approvals > 0) return 'approval'
  if (run.status === 'running') return run.failures > 0 ? 'retrying' : 'running'
  if (run.failures >= AGENT_RUN_MAX_FAILURES) return 'failed'
  if (agentRunLimitReached(run)) return 'finished'
  if (!run.autonomous && run.reason === AGENT_RUN_REVIEW_REASON) return 'review'
  return 'paused'
}

function tileDetail(run: AgentRun, state: DockTileState, chat: DockChatActivity | undefined, approvals: DockApproval[]): string {
  if (state === 'approval') {
    const first = approvals[0]!
    const more = approvals.length > 1 ? ` and ${approvals.length - 1} more` : ''
    return `Asking to read ${first.credentialLabel}${more}`
  }
  if (state === 'running') {
    if (!chat?.running) return run.cycle === 0 ? 'Starting' : 'Starting the next cycle'
    return chat.activity || 'Working'
  }
  return run.reason || 'Paused'
}

export function dockTiles(runs: readonly AgentRun[], chats: readonly DockChatActivity[], approvals: readonly DockApproval[], now: number = Date.now()): DockTile[] {
  const chatById = new Map(chats.map((chat) => [chat.paneId, chat]))
  return runs.map((run) => {
    const waiting = approvals.filter((request) => request.paneId === run.chatId)
    const state = dockTileState(run, waiting.length)
    const attentionKey = !ATTENTION.has(state) ? null
      : state === 'approval' ? `${run.chatId}:approval:${waiting.map((request) => request.id).join(',')}`
      : `${run.chatId}:${state}:${run.updatedAt}`
    return {
      chatId: run.chatId,
      name: run.name || 'Agent',
      state,
      running: run.status === 'running',
      cycleLabel: run.maxCycles === null ? `Cycle ${run.cycle}` : `Cycle ${run.cycle} of ${run.maxCycles}`,
      timeLabel: describeAgentRunRemaining(run, now),
      detail: tileDetail(run, state, chatById.get(run.chatId), waiting),
      attentionKey,
      brief: agentRunBrief(run, now)
    }
  }).sort((a, b) => ORDER[a.state] - ORDER[b.state])
}

/** The overview's one-line status. */
export function dockSummary(tiles: readonly DockTile[]): string {
  if (tiles.length === 0) return 'No agents running'
  const running = tiles.filter((tile) => tile.state === 'running' || tile.state === 'retrying').length
  const needs = tiles.filter((tile) => tile.attentionKey !== null).length
  const paused = tiles.length - running - needs
  const parts = [running ? `${running} running` : '', needs ? `${needs} need${needs === 1 ? 's' : ''} you` : '', paused ? `${paused} paused` : '']
  return parts.filter(Boolean).join(' · ')
}
