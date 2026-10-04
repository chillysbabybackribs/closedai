import assert from 'node:assert/strict'
import test from 'node:test'
import type { SavedAgent } from '../../shared/agent-library.js'
import { AGENT_RUN_MAX_MINUTES } from '../../shared/agent-runs.js'
import {
  EMPTY_DRAFT, EMPTY_NOTES, describeSuggestedLimits, draftMaxMinutes, draftOf, editedByHand, oneOffStartOptions, sameDraft,
  savedDraftOf, timeFieldsOf, timeLimitError, withAcceptedProposal, withOptimizeResult, withSuggestedLimits, withTimeLimit, withUndoneOptimize,
  type AgentBuilderState
} from './agent-draft.ts'

const saved: SavedAgent = {
  id: 'a1', name: 'Docs sweep', description: 'keep docs current', prompt: 'Each cycle…', maxCycles: 12, maxMinutes: 240, autonomous: false,
  createdAt: 1, updatedAt: 1, lastRunAt: null, runCount: 0
}

test('a saved agent loads into the editor and saves back unchanged; whole hours read as hours', () => {
  const draft = draftOf(saved)
  assert.deepEqual([draft.timeLimited, draft.timeAmount, draft.timeUnit, draft.maxCycles, draft.autonomous], [true, '4', 'hours', '12', false])
  assert.deepEqual(savedDraftOf(draft), { name: 'Docs sweep', description: 'keep docs current', prompt: 'Each cycle…', maxCycles: 12, maxMinutes: 240, autonomous: false })
  assert.deepEqual(timeFieldsOf(90), { timeLimited: true, timeAmount: '90', timeUnit: 'minutes' })
  assert.deepEqual(timeFieldsOf(null), { timeLimited: false, timeAmount: '', timeUnit: 'minutes' })
  assert.equal(sameDraft(draft, { ...draft, timeAmount: '240', timeUnit: 'minutes', name: ' Docs sweep ' }), true, 'the same limit in another unit is not a change')
  assert.equal(sameDraft(draft, { ...draft, description: 'keep docs current, weekly' }), false, 'the description is part of the agent')
  assert.equal(sameDraft(draft, { ...draft, autonomous: true }), false)
})

test('a time limit is whole minutes from the amount and unit, and off means none', () => {
  assert.equal(draftMaxMinutes({ timeLimited: true, timeAmount: '30', timeUnit: 'minutes' }), 30)
  assert.equal(draftMaxMinutes({ timeLimited: true, timeAmount: '1.5', timeUnit: 'hours' }), 90)
  assert.equal(draftMaxMinutes({ timeLimited: false, timeAmount: '30', timeUnit: 'minutes' }), null)
  assert.equal(oneOffStartOptions({ ...EMPTY_DRAFT, prompt: ' Go. ', timeLimited: true, timeAmount: '2', timeUnit: 'hours' }).maxMinutes, 120)
  assert.deepEqual(oneOffStartOptions({ ...EMPTY_DRAFT, prompt: 'Go.' }), { prompt: 'Go.', maxCycles: null, maxMinutes: null, autonomous: true, agentId: null, name: null })
})

test('a time limit that is on but unreadable is an error, never a silent no-limit', () => {
  for (const timeAmount of ['', '0', '-5', 'soon']) {
    const fields = { timeLimited: true, timeAmount, timeUnit: 'minutes' as const }
    assert.equal(draftMaxMinutes(fields), null)
    assert.match(timeLimitError(fields) ?? '', /at least 1 minute/)
  }
  assert.match(timeLimitError({ timeLimited: true, timeAmount: String(AGENT_RUN_MAX_MINUTES / 60 + 1), timeUnit: 'hours' }) ?? '', /at most 168 h/)
  assert.equal(timeLimitError({ timeLimited: false, timeAmount: 'soon', timeUnit: 'minutes' }), null)
  assert.equal(timeLimitError({ timeLimited: true, timeAmount: '45', timeUnit: 'minutes' }), null)
  assert.equal(withTimeLimit(EMPTY_DRAFT, true).timeAmount, '30', 'switching on starts with an amount')
  assert.equal(withTimeLimit({ ...EMPTY_DRAFT, timeAmount: '5' }, true).timeAmount, '5')
})

test('instructions count as edited by hand unless they are exactly what the optimizer wrote', () => {
  assert.equal(editedByHand('', EMPTY_NOTES), false, 'nothing to lose')
  assert.equal(editedByHand('My own text.', EMPTY_NOTES), true, 'a saved or typed prompt is the user\'s')
  const notes = { generated: 'You are the docs agent.', assumptions: [], replaced: null }
  assert.equal(editedByHand(' You are the docs agent.\n', notes), false)
  assert.equal(editedByHand('You are the docs agent. Never push.', notes), true)
})

test('suggested limits are described only when they differ from the editor, and applying them fills the fields', () => {
  const draft = { ...EMPTY_DRAFT, maxCycles: '40' }
  assert.equal(describeSuggestedLimits(draft, { maxCycles: 40, maxMinutes: null }), null)
  assert.equal(describeSuggestedLimits(draft, { maxCycles: 25, maxMinutes: 120 }), '25 cycles, 2 h')
  assert.equal(describeSuggestedLimits(draft, { maxCycles: null, maxMinutes: null }), 'no cycle limit, no time limit')
  const applied = withSuggestedLimits(draft, { maxCycles: 25, maxMinutes: 120 })
  assert.deepEqual([applied.maxCycles, applied.timeLimited, applied.timeAmount, applied.timeUnit], ['25', true, '2', 'hours'])
  assert.equal(applied.autonomous, draft.autonomous, 'a suggestion never touches autonomy')
})

const RESULT = { name: 'Docs sweep', prompt: 'You are the docs agent.', assumptions: ['It does not commit.'] }
const state = (patch: Partial<AgentBuilderState['draft']> = {}, notes = EMPTY_NOTES): AgentBuilderState =>
  ({ draft: { ...EMPTY_DRAFT, description: 'keep the docs current', ...patch }, notes, proposal: null })

test('an optimize result goes straight into an empty editor and never touches the description or the settings', () => {
  const before = state({ maxCycles: '7', autonomous: false })
  const after = withOptimizeResult(before, RESULT)
  assert.equal(after.draft.prompt, 'You are the docs agent.')
  assert.equal(after.draft.name, 'Docs sweep', 'a blank name takes the suggestion')
  assert.equal(after.draft.description, 'keep the docs current')
  assert.deepEqual([after.draft.maxCycles, after.draft.timeLimited, after.draft.autonomous], ['7', false, false])
  assert.deepEqual(after.notes, { generated: 'You are the docs agent.', assumptions: ['It does not commit.'], replaced: null })
  assert.equal(after.proposal, null)
  assert.equal(withOptimizeResult(state({ name: 'Mine' }), RESULT).draft.name, 'Mine', 'a name the user typed is kept')
})

test('instructions edited by hand are never replaced by an optimize: the new version waits as a proposal', () => {
  const mine = state({ prompt: 'My careful instructions.' })
  const offered = withOptimizeResult(mine, RESULT)
  assert.equal(offered.draft.prompt, 'My careful instructions.', 'nothing was overwritten')
  assert.deepEqual(offered.proposal, { prompt: 'You are the docs agent.', assumptions: ['It does not commit.'], view: 'proposed' })
  assert.deepEqual(offered.notes, EMPTY_NOTES)
  // Keep mine: dropping the proposal leaves the editor exactly as it was.
  assert.deepEqual({ ...offered, proposal: null }.draft, { ...mine.draft, name: 'Docs sweep' })
  // Use the new version: theirs is kept for Undo.
  const accepted = withAcceptedProposal(offered)
  assert.equal(accepted.draft.prompt, 'You are the docs agent.')
  assert.equal(accepted.notes.replaced, 'My careful instructions.')
  assert.equal(accepted.proposal, null)
  const undone = withUndoneOptimize(accepted)
  assert.equal(undone.draft.prompt, 'My careful instructions.')
  assert.equal(editedByHand(undone.draft.prompt, undone.notes), true, 'restored text is the user\'s again')
})

test('re-optimizing untouched optimizer text replaces it and keeps the previous version for Undo', () => {
  const first = withOptimizeResult(state(), RESULT)
  const second = withOptimizeResult(first, { name: 'Other', prompt: 'You are the docs agent, revised.', assumptions: [] })
  assert.equal(second.proposal, null)
  assert.equal(second.draft.prompt, 'You are the docs agent, revised.')
  assert.equal(second.draft.name, 'Docs sweep', 'the name from the first run is now the user\'s')
  assert.equal(second.notes.replaced, 'You are the docs agent.')
  assert.equal(withUndoneOptimize(second).draft.prompt, 'You are the docs agent.')
  const edited: AgentBuilderState = { ...first, draft: { ...first.draft, prompt: 'You are the docs agent. Never push.' } }
  assert.ok(withOptimizeResult(edited, RESULT).proposal, 'one hand edit is enough to be asked')
  const untouched = state()
  assert.equal(withUndoneOptimize(untouched), untouched, 'nothing to undo changes nothing')
})
