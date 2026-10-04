import assert from 'node:assert/strict'
import test from 'node:test'
import { SAVED_AGENT_DESCRIPTION_MAX } from '../../shared/agent-library.js'
import { AGENT_OPTIMIZE_MIN_DESCRIPTION_CHARS } from '../../shared/agent-optimizer.js'
import { AGENT_SUGGESTION_COUNT, AGENT_SUGGESTIONS, createSuggestionRotation, pickSuggestions, type RandomSource } from './agent-suggestions.ts'

/** A repeatable stream of numbers in [0, 1). */
function seeded(seed: number): RandomSource {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

test('the pool is varied and every idea is a usable description', () => {
  const ids = new Set(AGENT_SUGGESTIONS.map((idea) => idea.id))
  assert.equal(ids.size, AGENT_SUGGESTIONS.length, 'ids are unique')
  const categories = new Set(AGENT_SUGGESTIONS.map((idea) => idea.category))
  assert.ok(AGENT_SUGGESTIONS.length >= 16)
  assert.ok(categories.size >= 8, 'not five versions of the same thing')
  for (const wanted of ['Code health', 'Test coverage', 'Research', 'Docs upkeep', 'UI checks', 'Dependency review']) assert.ok(categories.has(wanted), wanted)
  for (const idea of AGENT_SUGGESTIONS) {
    assert.ok(idea.title.length <= 28, `${idea.id} title fits a card`)
    assert.ok(idea.blurb.length <= 72, `${idea.id} blurb fits a card`)
    assert.ok(idea.description.length >= 200 && idea.description.length <= SAVED_AGENT_DESCRIPTION_MAX, `${idea.id} is a solid starting point`)
    assert.ok(idea.description.length >= AGENT_OPTIMIZE_MIN_DESCRIPTION_CHARS)
    assert.doesNotMatch(idea.description, /closedai/i, `${idea.id} is not about this app`)
  }
})

test('a set shows different categories and prefers ideas that were not just shown', () => {
  const picked = pickSuggestions(AGENT_SUGGESTIONS, AGENT_SUGGESTION_COUNT, seeded(7))
  assert.equal(picked.length, AGENT_SUGGESTION_COUNT)
  assert.equal(new Set(picked.map((idea) => idea.category)).size, AGENT_SUGGESTION_COUNT)
  const avoid = new Set(picked.map((idea) => idea.id))
  const next = pickSuggestions(AGENT_SUGGESTIONS, AGENT_SUGGESTION_COUNT, seeded(7), avoid)
  assert.ok(next.every((idea) => !avoid.has(idea.id)), 'the same shuffle still deals new ideas')
  const few = AGENT_SUGGESTIONS.filter((idea) => idea.category === 'Code health')
  assert.equal(pickSuggestions(few, 3, seeded(1)).length, 3, 'one category still fills the row')
  assert.equal(pickSuggestions(few.slice(0, 2), 4, seeded(1)).length, 2)
})

test('the rotation never repeats the previous set and comes round the whole pool', () => {
  for (const seed of [1, 2, 3, 99]) {
    const rotation = createSuggestionRotation(AGENT_SUGGESTIONS, AGENT_SUGGESTION_COUNT, seeded(seed))
    const shown = new Set<string>()
    let previous = new Set<string>()
    for (let visit = 0; visit < 12; visit += 1) {
      const ids = rotation.next().map((idea) => idea.id)
      assert.equal(ids.length, AGENT_SUGGESTION_COUNT)
      assert.ok(ids.every((id) => !previous.has(id)), `visit ${visit} repeats nothing from the visit before`)
      previous = new Set(ids)
      for (const id of ids) shown.add(id)
    }
    assert.equal(shown.size, AGENT_SUGGESTIONS.length, 'every idea has had its turn')
  }
  const first = createSuggestionRotation(AGENT_SUGGESTIONS, AGENT_SUGGESTION_COUNT, seeded(5)).next().map((idea) => idea.id)
  const other = createSuggestionRotation(AGENT_SUGGESTIONS, AGENT_SUGGESTION_COUNT, seeded(6)).next().map((idea) => idea.id)
  assert.notDeepEqual(first, other, 'a different session opens on different ideas')
})
