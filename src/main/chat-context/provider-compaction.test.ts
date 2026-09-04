import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import { buildCompactionSeed, compactedAdditionalContext, COMPACTED_CONTEXT, wrapCompactedContext } from './provider-compaction.ts'

const user = (id: string, text: string): ChatTranscriptItem => ({ type: 'user', id, turnId: id, text })
const answer = (id: string, text: string): ChatTranscriptItem =>
  ({ type: 'assistant', id, turnId: id, text, phase: 'final_answer', streaming: false })

test('compaction seeds use compaction framing and wrap as untrusted context', () => {
  const seed = buildCompactionSeed([user('u1', 'Fix the header'), answer('a1', 'Done.')], 'Header work')
  assert.ok(seed)
  assert.match(seed!, /compact(ed)? to reduce provider-side context/)
  assert.match(seed!, /User: Fix the header\nAssistant: Done\.$/)
  assert.doesNotMatch(seed!, /Handoff from the previous chat/)
  assert.equal(wrapCompactedContext(seed!), `<compacted_conversation_context>\n${seed}\n</compacted_conversation_context>`)
  assert.deepEqual(compactedAdditionalContext(seed!), { [COMPACTED_CONTEXT]: { kind: 'untrusted', value: wrapCompactedContext(seed!) } })
})

test('an empty transcript cannot be compacted', () => {
  assert.equal(buildCompactionSeed([], null), null)
})
