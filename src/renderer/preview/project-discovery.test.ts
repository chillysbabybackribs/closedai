import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceDiscovery, clarityItems, createDiscovery, isDirectionReady } from './project-discovery.ts'

const IDEA = 'A desktop research tool for journalists that links captured source pages to claims.'

test('vague answers are challenged and do not fill the record', () => {
  let state = createDiscovery()
  const short = advanceDiscovery(state, 'an app')
  assert.equal(short.state.record.idea, '')
  assert.match(short.reply, /not enough to build from/)

  state = advanceDiscovery(state, IDEA).state
  assert.equal(state.asking, 'user')
  const vague = advanceDiscovery(state, 'everyone who reads news')
  assert.equal(vague.state.record.user, null)
  assert.match(vague.reply, /“Everyone” is not a user/)
  assert.equal(vague.state.asking, 'user')
})

test('the record fills one slot per exchange and gates readiness on evidence and all slots', () => {
  let state = createDiscovery()
  assert.equal(isDirectionReady(state.record), false)
  state = advanceDiscovery(state, IDEA).state
  assert.equal(state.record.idea, IDEA)
  assert.equal(state.record.evidence.length, 2, 'research lands as soon as the idea is captured')
  assert.equal(isDirectionReady(state.record), false)

  state = advanceDiscovery(state, 'Investigative journalists at small newsrooms.').state
  state = advanceDiscovery(state, 'Capture a source page and link it to one claim in a draft.').state
  assert.equal(state.record.evidence.length, 3)
  assert.equal(isDirectionReady(state.record), false)

  const final = advanceDiscovery(state, 'Not a general note app; offline-first and citations are non-negotiable.')
  assert.equal(final.state.asking, null)
  assert.equal(isDirectionReady(final.state.record), true)
  assert.equal(final.state.record.unknowns.length, 2)
  assert.match(final.reply, /I understand what we are building/)
  assert.ok(clarityItems(final.state.record).every((item) => item.captured))

  const refined = advanceDiscovery(final.state, 'Also needs to export to the newsroom CMS.')
  assert.equal(refined.state.record.idea, IDEA, 'original words are never rewritten')
  assert.deepEqual(refined.state.record.refinements, ['Also needs to export to the newsroom CMS.'])
})
