import { cleanAgentName, type SavedAgent, type SavedAgentDraft } from '../../shared/agent-library.js'
import type { AgentOptimizeResult } from '../../shared/agent-optimizer.js'
import { AGENT_RUN_MAX_MINUTES, formatAgentMinutes, type AgentRunStartOptions } from '../../shared/agent-runs.js'

// The Build screen's editor state and the rules that turn it into a saved agent or a run. Fields
// hold what the user typed (numbers stay strings until they are used), and a time limit that is
// switched on but unreadable is an error, never a silent "no limit". Pure, so the rules are testable.

export type AgentTimeUnit = 'minutes' | 'hours'

export type AgentDraft = {
  name: string
  /** What the user wants, in their own words; kept with the agent so it can be revised and optimized again. */
  description: string
  /** The standing instructions the run is started with. */
  prompt: string
  maxCycles: string
  timeLimited: boolean
  timeAmount: string
  timeUnit: AgentTimeUnit
  autonomous: boolean
}

/** Where the instructions in the editor came from; kept beside the draft while the dialog is open. */
export type AgentBuilderNotes = {
  /** The instructions exactly as the optimizer last wrote them; text that differs was edited by hand. */
  generated: string | null
  /** What the optimizer assumed when it wrote them. */
  assumptions: string[]
  /** The instructions the last optimize replaced, for Undo; null when there were none. */
  replaced: string | null
}

/** A draft the user backed out of, restored when they return to it this session. */
export type HeldAgentDraft = { draft: AgentDraft; notes: AgentBuilderNotes }

export const EMPTY_DRAFT: AgentDraft = {
  name: '', description: '', prompt: '', maxCycles: '', timeLimited: false, timeAmount: '', timeUnit: 'minutes', autonomous: true
}

export const EMPTY_NOTES: AgentBuilderNotes = { generated: null, assumptions: [], replaced: null }

/** A time limit switched on with nothing typed starts here. */
const DEFAULT_TIME_AMOUNT = '30'

/** The editor's three time fields for a stored limit: whole hours read as hours, anything else as minutes. */
export function timeFieldsOf(minutes: number | null): Pick<AgentDraft, 'timeLimited' | 'timeAmount' | 'timeUnit'> {
  if (minutes === null) return { timeLimited: false, timeAmount: '', timeUnit: 'minutes' }
  return minutes % 60 === 0
    ? { timeLimited: true, timeAmount: String(minutes / 60), timeUnit: 'hours' }
    : { timeLimited: true, timeAmount: String(minutes), timeUnit: 'minutes' }
}

export function draftOf(agent: SavedAgent): AgentDraft {
  return {
    name: agent.name, description: agent.description, prompt: agent.prompt,
    maxCycles: agent.maxCycles === null ? '' : String(agent.maxCycles),
    ...timeFieldsOf(agent.maxMinutes), autonomous: agent.autonomous
  }
}

/** Switching the time limit on fills a starting amount, so the switch never reads on with no limit behind it. */
export function withTimeLimit(draft: AgentDraft, on: boolean): AgentDraft {
  return { ...draft, timeLimited: on, timeAmount: on && !draft.timeAmount.trim() ? DEFAULT_TIME_AMOUNT : draft.timeAmount }
}

export function parseMaxCycles(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** The time limit in whole minutes; null when it is off or the amount cannot be read. */
export function draftMaxMinutes(draft: Pick<AgentDraft, 'timeLimited' | 'timeAmount' | 'timeUnit'>): number | null {
  if (!draft.timeLimited) return null
  const amount = Number(draft.timeAmount.trim())
  if (!draft.timeAmount.trim() || !Number.isFinite(amount) || amount <= 0) return null
  const minutes = Math.round(amount * (draft.timeUnit === 'hours' ? 60 : 1))
  return minutes >= 1 && minutes <= AGENT_RUN_MAX_MINUTES ? minutes : null
}

/** Why a switched-on time limit cannot be used, or null when it is fine (or off). */
export function timeLimitError(draft: Pick<AgentDraft, 'timeLimited' | 'timeAmount' | 'timeUnit'>): string | null {
  if (!draft.timeLimited || draftMaxMinutes(draft) !== null) return null
  const amount = Number(draft.timeAmount.trim())
  if (Number.isFinite(amount) && amount * (draft.timeUnit === 'hours' ? 60 : 1) > AGENT_RUN_MAX_MINUTES) {
    return `The time limit can be at most ${formatAgentMinutes(AGENT_RUN_MAX_MINUTES)}`
  }
  return 'Enter a time limit of at least 1 minute, or switch it off'
}

/** Whether two drafts would save the same agent; whitespace and unit spelling do not count. */
export function sameDraft(a: AgentDraft, b: AgentDraft): boolean {
  return a.name.trim() === b.name.trim() && a.description.trim() === b.description.trim() && a.prompt.trim() === b.prompt.trim()
    && parseMaxCycles(a.maxCycles) === parseMaxCycles(b.maxCycles) && a.timeLimited === b.timeLimited
    && draftMaxMinutes(a) === draftMaxMinutes(b) && a.autonomous === b.autonomous
}

/** The draft as the library stores it. */
export function savedDraftOf(draft: AgentDraft): SavedAgentDraft {
  return {
    name: cleanAgentName(draft.name), description: draft.description.trim(), prompt: draft.prompt.trim(),
    maxCycles: parseMaxCycles(draft.maxCycles), maxMinutes: draftMaxMinutes(draft), autonomous: draft.autonomous
  }
}

/** A nameless draft started as it stands: a one-off run that is not kept in the library. */
export function oneOffStartOptions(draft: AgentDraft): AgentRunStartOptions {
  return {
    prompt: draft.prompt.trim(), maxCycles: parseMaxCycles(draft.maxCycles), maxMinutes: draftMaxMinutes(draft),
    autonomous: draft.autonomous, agentId: null, name: null
  }
}

/** The instructions were written or changed by hand, so an optimize must ask before replacing them. */
export function editedByHand(prompt: string, notes: AgentBuilderNotes): boolean {
  const current = prompt.trim()
  return current !== '' && current !== (notes.generated ?? '').trim()
}

/** A new version of the instructions waiting for the user's decision, and which text is on screen. */
export type InstructionsProposal = { prompt: string; assumptions: string[]; view: 'proposed' | 'current' }

/** Everything an optimize result can change in the editor. */
export type AgentBuilderState = { draft: AgentDraft; notes: AgentBuilderNotes; proposal: InstructionsProposal | null }

/** Write optimizer instructions into the editor, keeping the text they replace for Undo. */
function withInstructions(state: AgentBuilderState, written: Pick<AgentOptimizeResult, 'prompt' | 'assumptions'>): AgentBuilderState {
  return {
    draft: { ...state.draft, prompt: written.prompt },
    notes: { generated: written.prompt, assumptions: written.assumptions, replaced: state.draft.prompt.trim() ? state.draft.prompt : null },
    proposal: null
  }
}

/**
 * An optimize result arrives. A suggested name fills only a blank name. Instructions the user
 * edited by hand are left exactly as they are and the new version becomes a proposal; otherwise
 * the new version goes straight in. Limits and autonomy are not touched here.
 */
export function withOptimizeResult(state: AgentBuilderState, result: Pick<AgentOptimizeResult, 'name' | 'prompt' | 'assumptions'>): AgentBuilderState {
  const named: AgentBuilderState = cleanAgentName(state.draft.name) || !result.name ? state : { ...state, draft: { ...state.draft, name: result.name } }
  if (editedByHand(named.draft.prompt, named.notes)) {
    return { ...named, proposal: { prompt: result.prompt, assumptions: result.assumptions, view: 'proposed' } }
  }
  return withInstructions(named, result)
}

/** The user chose the proposed version; theirs is kept for Undo. */
export function withAcceptedProposal(state: AgentBuilderState): AgentBuilderState {
  return state.proposal ? withInstructions(state, state.proposal) : state
}

/** Bring back the instructions the last optimize replaced; they are the user's again, so the next optimize asks. */
export function withUndoneOptimize(state: AgentBuilderState): AgentBuilderState {
  if (state.notes.replaced === null) return state
  return { ...state, draft: { ...state.draft, prompt: state.notes.replaced }, notes: EMPTY_NOTES }
}

export type SuggestedLimits = { maxCycles: number | null; maxMinutes: number | null }

/** How the optimizer's suggested limits read, or null when the editor already holds them. */
export function describeSuggestedLimits(draft: AgentDraft, suggested: SuggestedLimits): string | null {
  if (suggested.maxCycles === parseMaxCycles(draft.maxCycles) && suggested.maxMinutes === draftMaxMinutes(draft)) return null
  const cycles = suggested.maxCycles === null ? 'no cycle limit' : `${suggested.maxCycles} cycles`
  const time = suggested.maxMinutes === null ? 'no time limit' : formatAgentMinutes(suggested.maxMinutes)
  return `${cycles}, ${time}`
}

export function withSuggestedLimits(draft: AgentDraft, suggested: SuggestedLimits): AgentDraft {
  return { ...draft, maxCycles: suggested.maxCycles === null ? '' : String(suggested.maxCycles), ...timeFieldsOf(suggested.maxMinutes) }
}
