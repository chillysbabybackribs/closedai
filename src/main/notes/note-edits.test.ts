import assert from 'node:assert/strict'
import test from 'node:test'

import { applyNoteEdit, NoteEditError } from './note-edits.js'

const plan = '# Plan\n\n- snapshot\n- migrate\n- drop legacy'

test('a quoted replacement reports the lines it wrote', () => {
  const result = applyNoteEdit(plan, { kind: 'replace-text', oldText: '- migrate', newText: '- [ ] migrate\n- [ ] verify' })
  assert.equal(result.text, '# Plan\n\n- snapshot\n- [ ] migrate\n- [ ] verify\n- drop legacy')
  assert.deepEqual(result.edited, { from: 4, to: 5 })
})

test('an ambiguous or stale quote is refused with a reason the model can act on', () => {
  assert.throws(() => applyNoteEdit(plan, { kind: 'replace-text', oldText: '- ', newText: '* ' }), NoteEditError)
  assert.throws(() => applyNoteEdit(plan, { kind: 'replace-text', oldText: 'nowhere', newText: 'x' }), /not found/)
  const all = applyNoteEdit(plan, { kind: 'replace-text', oldText: '- ', newText: '- [ ] ', all: true })
  assert.equal(all.text, '# Plan\n\n- [ ] snapshot\n- [ ] migrate\n- [ ] drop legacy')
  assert.deepEqual(all.edited, { from: 3, to: 5 })
})

test('line ranges replace, insert and delete', () => {
  assert.deepEqual(applyNoteEdit(plan, { kind: 'replace-lines', from: 3, to: 3, text: '- snapshot chats.json' }),
    { text: '# Plan\n\n- snapshot chats.json\n- migrate\n- drop legacy', edited: { from: 3, to: 3 } })
  assert.deepEqual(applyNoteEdit(plan, { kind: 'replace-lines', from: 2, to: 1, text: 'Intro' }).edited, { from: 2, to: 2 })
  const removed = applyNoteEdit(plan, { kind: 'replace-lines', from: 2, to: 2, text: '' })
  assert.equal(removed.text, '# Plan\n- snapshot\n- migrate\n- drop legacy')
  assert.deepEqual(removed.edited, { from: 2, to: 1 })
  assert.throws(() => applyNoteEdit(plan, { kind: 'replace-lines', from: 9, to: 9, text: 'x' }), /outside the note/)
})

test('append starts on its own line and rewrite marks the whole note', () => {
  assert.deepEqual(applyNoteEdit('a', { kind: 'append', text: 'b\nc' }), { text: 'a\nb\nc', edited: { from: 2, to: 3 } })
  assert.deepEqual(applyNoteEdit('a\n', { kind: 'append', text: 'b' }), { text: 'a\nb', edited: { from: 2, to: 2 } })
  assert.deepEqual(applyNoteEdit('', { kind: 'append', text: 'b' }), { text: 'b', edited: { from: 1, to: 1 } })
  assert.deepEqual(applyNoteEdit(plan, { kind: 'rewrite', text: 'x\ny' }).edited, { from: 1, to: 2 })
})
