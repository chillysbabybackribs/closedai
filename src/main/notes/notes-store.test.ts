import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import type { NoteChange } from '../../shared/notes.js'
import { NotesStore } from './notes-store.js'

const dirs: string[] = []
after(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))) })
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'notes-store-'))
  dirs.push(dir)
  return dir
}

test('notes survive a reopen with their titles and revisions', async () => {
  const dir = await scratch()
  const store = await NotesStore.open(dir)
  const note = store.create({ text: '# Migration plan\n- step' })
  assert.equal(note.title, 'Migration plan')
  assert.equal(store.save(note.id, '# Migration plan\n- step\n- more', 1).ok, true)
  const named = store.create({ text: 'x', title: 'scratch' })
  await store.flush()
  const reopened = await NotesStore.open(dir)
  const back = reopened.read(note.id)!
  assert.equal(back.text, '# Migration plan\n- step\n- more')
  assert.equal(back.revision, 2)
  assert.equal(back.lineCount, 3)
  assert.equal(reopened.read(named.id)?.title, 'scratch')
  assert.equal(reopened.find('SCRATCH')?.id, named.id)
  assert.equal(reopened.find('migration')?.id, note.id)
})

test('an editor save built before a model edit is refused, never overwriting the edit', async () => {
  const store = await NotesStore.open(await scratch())
  const changes: NoteChange[] = []
  store.on('changed', (change: NoteChange) => changes.push(change))
  const note = store.create({ text: '- a\n- b' })
  const { applied } = store.edit(note.id, { kind: 'replace-text', oldText: '- b', newText: '- [ ] b' })
  assert.deepEqual(applied.edited, { from: 2, to: 2 })
  const stale = store.save(note.id, '- a typed\n- b', note.revision)
  assert.equal(stale.ok, false)
  assert.equal(stale.ok === false && stale.note.text, '- a\n- [ ] b')
  assert.equal(store.save(note.id, '- a typed\n- [ ] b', 2).ok, true)
  assert.equal(store.read(note.id)?.text, '- a typed\n- [ ] b')
  assert.deepEqual(changes.map((change) => [change.origin, change.edited ?? null]), [
    ['editor', null], ['model', { from: 2, to: 2 }], ['editor', null]
  ])
  await store.flush()
})

test('removing a note deletes its file; a corrupt index starts clean', async () => {
  const dir = await scratch()
  const store = await NotesStore.open(dir)
  const note = store.create({ text: 'gone soon' })
  await store.flush()
  store.remove(note.id)
  await store.flush()
  assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith('.txt')), [])
  assert.match(await readFile(join(dir, 'index.json'), 'utf8'), /"notes":\[\]/)
  await writeFile(join(dir, 'index.json'), '{not json')
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.deepEqual((await NotesStore.open(dir)).list(), [])
  } finally {
    console.warn = warn
  }
})
