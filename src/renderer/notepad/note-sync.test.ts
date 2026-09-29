import assert from 'node:assert/strict'
import test from 'node:test'
import { ChangeSet, Text } from '@codemirror/state'

import type { NoteChange, NoteSaveResult } from '../../shared/notes.js'
import { diff, NoteSync } from './note-sync.js'

/** A buffer plus a fake main that accepts saves on the current revision, like NotesStore.save. */
function harness(initial: string) {
  let doc = Text.of(initial.split('\n'))
  const main = { text: initial, revision: 1 }
  const events: NoteChange[] = []
  const change = (text: string, origin: NoteChange['origin']): NoteChange => ({
    note: { id: 'n', title: 't', named: false, createdAt: 0, updatedAt: 0, revision: main.revision, lineCount: 1 }, text, origin
  })
  const sync = new NoteSync('n', { text: initial, revision: 1 }, {
    save: async (_id, text, base): Promise<NoteSaveResult> => {
      if (base !== main.revision) return { ok: false, note: { ...change(main.text, 'model').note, text: main.text } }
      main.text = text
      main.revision += 1
      const echo = change(text, 'editor')
      events.push(echo)
      sync.received(echo)
      return { ok: true, note: echo.note }
    },
    doc: () => doc,
    applyRemote: (changes) => { doc = changes.apply(doc) },
    onError: (reason) => { throw reason }
  })
  const type = (from: number, insert: string): void => {
    const changes = ChangeSet.of({ from, insert }, doc.length)
    doc = changes.apply(doc)
    sync.typed(changes)
  }
  const modelEdit = (text: string): void => {
    main.text = text
    main.revision += 1
    sync.received(change(text, 'model'))
  }
  return { sync, main, type, modelEdit, text: () => doc.toString() }
}

test('a model edit folds into unsaved typing and the next save keeps both', async () => {
  const h = harness('# Plan\n- a\n- b')
  h.type(6, ' v2')
  h.modelEdit('# Plan\n- a\n- [ ] b')
  assert.equal(h.text(), '# Plan v2\n- a\n- [ ] b')
  await h.sync.flush()
  assert.equal(h.main.text, '# Plan v2\n- a\n- [ ] b')
  assert.equal(h.sync.dirty, false)
  h.sync.dispose()
})

test('a save refused because a model edit landed first is retried on the new revision', async () => {
  const h = harness('one\ntwo')
  h.type(3, '!')
  // Main moved on without this buffer hearing yet: the save is refused, then the event rebases it.
  h.main.text = 'one\ntwo\nthree'
  h.main.revision += 1
  await h.sync.flush()
  assert.equal(h.main.text, 'one\ntwo\nthree')
  h.sync.received({ note: { id: 'n', title: 't', named: false, createdAt: 0, updatedAt: 0, revision: h.main.revision, lineCount: 3 }, text: 'one\ntwo\nthree', origin: 'model' })
  assert.equal(h.text(), 'one!\ntwo\nthree')
  await h.sync.flush()
  assert.equal(h.main.text, 'one!\ntwo\nthree')
  h.sync.dispose()
})

test('diff is one replacement between the common prefix and suffix', () => {
  const changes = diff('- a\n- b\n- c', '- a\n- [ ] b\n- c')
  assert.equal(changes.apply(Text.of(['- a', '- b', '- c'])).toString(), '- a\n- [ ] b\n- c')
  let count = 0
  changes.iterChanges(() => { count += 1 })
  assert.equal(count, 1)
})
