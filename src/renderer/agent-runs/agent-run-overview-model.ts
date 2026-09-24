import { AGENT_RUN_MAX_FAILURES, type AgentRun } from '../../shared/agent-runs.js'

// What the agent dock shows: one icon per run in the footer row, ordered so runs that need the
// user (an approval, a failure pause, a finished limit) come first. Pure so the rules are testable.

export type DockTileState = 'running' | 'retrying' | 'paused' | 'finished' | 'failed' | 'approval'

/** The slice of a chat row the dock reads: whether a turn is live and what it is doing. */
export type DockChatActivity = { paneId: string; running: boolean; activity: string | null }

/** The slice of a pending credential approval the dock reads. */
export type DockApproval = { id: string; paneId: string | null; credentialLabel: string }

export type DockTile = {
  chatId: string
  name: string
  state: DockTileState
  /** The run's own status, which decides Pause versus Resume. */
  running: boolean
  cycleLabel: string
  detail: string
  /** Set while the tile needs the user; changes when the reason changes, so it re-announces. */
  attentionKey: string | null
}

/** How each state reads in the icon's tooltip and the run card. */
export const DOCK_STATE_LABEL: Record<DockTileState, string> = {
  running: 'Running', retrying: 'Retrying', paused: 'Paused', finished: 'Finished',
  failed: 'Paused by failures', approval: 'Needs your approval'
}

const ATTENTION: ReadonlySet<DockTileState> = new Set(['approval', 'failed', 'finished'])
const ORDER: Record<DockTileState, number> = { approval: 0, failed: 1, finished: 2, retrying: 3, running: 4, paused: 5 }

export function dockTileState(run: AgentRun, approvals: number): DockTileState {
  if (approvals > 0) return 'approval'
  if (run.status === 'running') return run.failures > 0 ? 'retrying' : 'running'
  if (run.failures >= AGENT_RUN_MAX_FAILURES) return 'failed'
  if (run.maxCycles !== null && run.cycle >= run.maxCycles && run.reason?.startsWith('Reached ')) return 'finished'
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

export function dockTiles(runs: readonly AgentRun[], chats: readonly DockChatActivity[], approvals: readonly DockApproval[]): DockTile[] {
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
      detail: tileDetail(run, state, chatById.get(run.chatId), waiting),
      attentionKey
    }
  }).sort((a, b) => ORDER[a.state] - ORDER[b.state])
}

/** The dock's one-line status beside its icons. */
export function dockSummary(tiles: readonly DockTile[]): string {
  if (tiles.length === 0) return 'No agents running'
  const running = tiles.filter((tile) => tile.state === 'running' || tile.state === 'retrying').length
  const needs = tiles.filter((tile) => tile.attentionKey !== null).length
  const paused = tiles.length - running - needs
  const parts = [running ? `${running} running` : '', needs ? `${needs} need${needs === 1 ? 's' : ''} you` : '', paused ? `${paused} paused` : '']
  return parts.filter(Boolean).join(' · ')
}

/** Up to two letters that tell runs apart on their dock icons: "Daily brief" is DB. */
export function dockInitials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? []
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? 'A').slice(0, 2)
  return letters.toUpperCase()
}
