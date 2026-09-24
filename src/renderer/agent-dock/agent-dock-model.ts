import { AGENT_RUN_MAX_FAILURES, type AgentRun } from '../../shared/agent-runs.js'

// What the agent dock shows and when it shows itself. The dock is a thin rail at the bottom of
// the window that opens on a deliberate rest or click, so it never pops up under a composer by
// accident; a run that needs the user (an approval, a failure pause, a finished limit) opens it
// on its own and keeps it open until the user has looked. Pure so the rules are testable.

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

/** The rail's accessible label and the dock header's one-line summary. */
export function dockSummary(tiles: readonly DockTile[]): string {
  if (tiles.length === 0) return 'No agents running'
  const running = tiles.filter((tile) => tile.state === 'running' || tile.state === 'retrying').length
  const needs = tiles.filter((tile) => tile.attentionKey !== null).length
  const paused = tiles.length - running - needs
  const parts = [running ? `${running} running` : '', needs ? `${needs} need${needs === 1 ? 's' : ''} you` : '', paused ? `${paused} paused` : '']
  return parts.filter(Boolean).join(' · ')
}

export type DockReveal = {
  /** Opened by a rest on the rail or a click; closed by leaving, Escape, or a second click. */
  open: boolean
  /** Stays open through pointer leaves until unpinned or Escape. */
  pinned: boolean
  /** Attention keys the user has already looked at; pruned to the live set on every event. */
  seen: readonly string[]
}

export type DockEvent =
  | { type: 'open' }
  | { type: 'toggle' }
  | { type: 'pin' }
  /** The pointer left the rail and dock after a grace delay; what was showing counts as looked at. */
  | { type: 'leave' }
  | { type: 'escape' }
  /** The pointer entered or focus landed inside the dock. */
  | { type: 'look' }

export const DOCK_CLOSED: DockReveal = { open: false, pinned: false, seen: [] }

export function unseenAttention(reveal: DockReveal, attention: readonly string[]): string[] {
  return attention.filter((key) => !reveal.seen.includes(key))
}

export function dockVisible(reveal: DockReveal, attention: readonly string[]): boolean {
  return reveal.open || reveal.pinned || unseenAttention(reveal, attention).length > 0
}

export function reduceDock(reveal: DockReveal, event: DockEvent, attention: readonly string[]): DockReveal {
  const seen = reveal.seen.filter((key) => attention.includes(key))
  const all = [...attention]
  switch (event.type) {
    case 'open': return { ...reveal, open: true, seen }
    case 'toggle': return dockVisible(reveal, attention) ? { open: false, pinned: false, seen: all } : { ...reveal, open: true, seen }
    case 'pin': return { open: true, pinned: !reveal.pinned, seen }
    case 'leave': return { ...reveal, open: false, seen: all }
    case 'escape': return { open: false, pinned: false, seen: all }
    // Looking holds the dock open, so marking the attention seen cannot hide it under the pointer.
    case 'look': return { ...reveal, open: true, seen: all }
  }
}
