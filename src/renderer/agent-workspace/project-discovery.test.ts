import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceDiscovery, clarityItems, createDiscovery, isDirectionReady, syncDiscoveryWithItems } from './project-discovery.ts'
import { transcriptItemsToMessages } from './project-intake.js'
import type { ChatTranscriptItem } from '../../shared/chat.ts'

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

test('syncDiscoveryWithItems maps transcript items to direction record slots and gates readiness', () => {
  let state = createDiscovery()
  assert.equal(isDirectionReady(state.record), false)

  state = syncDiscoveryWithItems(state, [])
  assert.equal(state.record.idea, '')
  assert.equal(state.asking, 'idea')

  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u1', turnId: 't1', text: IDEA }
  ]
  state = syncDiscoveryWithItems(state, items)
  assert.equal(state.record.idea, IDEA)
  assert.equal(state.asking, 'user')
  assert.equal(isDirectionReady(state.record), false)

  items.push({ type: 'assistant', id: 'a1', turnId: 't1', text: 'Who is this for?', streaming: false, phase: null })
  state = syncDiscoveryWithItems(state, items)
  assert.equal(state.asking, 'user')

  items.push({ type: 'user', id: 'u2', turnId: 't2', text: 'Investigative journalists.' })
  state = syncDiscoveryWithItems(state, items)
  assert.equal(state.record.user, 'Investigative journalists.')
  assert.equal(state.asking, 'journey')

  items.push({ type: 'user', id: 'u3', turnId: 't3', text: 'Capture source pages and link to claims.' })
  state = syncDiscoveryWithItems(state, items)
  assert.equal(state.record.journey, 'Capture source pages and link to claims.')
  assert.equal(state.asking, 'boundaries')

  items.push({ type: 'tool', id: 'tool-1', turnId: 't3', label: 'search.query', detail: 'Prior art on web annotations', status: 'complete' })
  state = syncDiscoveryWithItems(state, items)
  assert.equal(state.record.evidence.length, 1)

  items.push({ type: 'user', id: 'u4', turnId: 't4', text: 'Offline-first only; no cloud storage.' })
  state = syncDiscoveryWithItems(state, items)
  assert.equal(state.record.boundaries, 'Offline-first only; no cloud storage.')
  assert.equal(state.asking, null)
  assert.equal(isDirectionReady(state.record), true)
  assert.ok(clarityItems(state.record).every((item) => item.captured))

  items.push({ type: 'user', id: 'u5', turnId: 't5', text: 'Export to PDF.' })
  state = syncDiscoveryWithItems(state, items)
  assert.deepEqual(state.record.refinements, ['Export to PDF.'])
  assert.equal(state.asking, null)
})

test('transcriptItemsToMessages maps user and assistant items to intake messages', () => {
  const items: ChatTranscriptItem[] = [
    { type: 'user', id: 'u0', turnId: 't0', text: '[Request interrupted by user]' },
    { type: 'user', id: 'u1', turnId: 't1', text: 'Hello' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'Hi, how can I help?', streaming: false, phase: null },
    { type: 'assistant', id: 'a2', turnId: 't1', text: '', streaming: true, phase: null }
  ]
  const msgs = transcriptItemsToMessages(items)
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0]!.role, 'user')
  assert.equal(msgs[0]!.text, 'Hello')
  assert.equal(msgs[1]!.role, 'coordinator')
  assert.equal(msgs[1]!.text, 'Hi, how can I help?')

  // Also verify syncDiscoveryWithItems ignores the interrupted user message
  let state = createDiscovery()
  state = syncDiscoveryWithItems(state, items)
  assert.equal(state.record.idea, 'Hello')
  assert.equal(state.asking, 'user')
})
