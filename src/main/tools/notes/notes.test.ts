import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { buildTurnAdditionalContext } from '../../chat-context/turn-context.js'
import { NotepadBindings } from '../../notes/notepad-bindings.js'
import { NotesStore } from '../../notes/notes-store.js'
import type { ToolContext, ToolDefinition, ToolResult } from '../tool.js'
import { notesTools } from './index.js'

const dirs: string[] = []
after(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))) })

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'notes-tools-'))
  dirs.push(dir)
  const store = await NotesStore.open(dir)
  const bindings = new NotepadBindings()
  const tools = new Map(notesTools({ store: () => store, bindings }).tools.map((tool) => [tool.name, tool]))
  const call = (name: string, input: Record<string, unknown>, paneId: string | null = 'chat-1'): Promise<ToolResult> =>
    (tools.get(name) as ToolDefinition).run(input, { paneId, threadId: null, turnId: null, callId: 'c', signal: new AbortController().signal } satisfies ToolContext)
  return { store, bindings, call }
}

test('notes tools defer on Codex so they do not join the eager wire set', () => {
  const store = null as unknown as NotesStore
  const bindings = new NotepadBindings()
  for (const tool of notesTools({ store: () => store, bindings }).tools) {
    assert.equal(tool.deferLoading, true, tool.name)
  }
})

const json = (result: ToolResult): Record<string, unknown> => JSON.parse((result.content[0] as { text: string }).text)

test('a notepad chat edits the note its turn started on, even after the user switches tabs', async () => {
  const { store, bindings, call } = await setup()
  const plan = store.create({ text: '# Plan\n- snapshot\n- migrate' })
  const scratch = store.create({ text: 'scratch' })
  bindings.bind({ chatPaneId: 'chat-1', noteIds: [plan.id, scratch.id], activeNoteId: plan.id })
  const context = bindings.turnContext('chat-1', (id) => store.read(id))!
  assert.match(context.activeNote!.text, /^1\| # Plan\n2\| - snapshot/)
  assert.deepEqual(context.otherTabs.map((tab) => tab.title), ['scratch'])
  assert.match(JSON.stringify(buildTurnAdditionalContext('anything', context)), /closedai\.notepad/)

  bindings.bind({ chatPaneId: 'chat-1', noteIds: [plan.id, scratch.id], activeNoteId: scratch.id })
  const edited = json(await call('edit', { from_line: 2, to_line: 3, text: '- [ ] snapshot\n- [ ] migrate' }))
  assert.equal(edited.id, plan.id)
  assert.deepEqual(edited.edited, { fromLine: 2, toLine: 3 })
  assert.equal(store.read(plan.id)!.text, '# Plan\n- [ ] snapshot\n- [ ] migrate')
  assert.equal(store.read(scratch.id)!.text, 'scratch')
})

test('misuse comes back as a usage result naming the fix', async () => {
  const { store, call } = await setup()
  store.create({ text: 'alpha' })
  const noWindow = await call('read', {}, 'elsewhere')
  assert.equal(noWindow.errorKind, 'usage')
  assert.match((noWindow.content[0] as { text: string }).text, /notes\.list/)
  const twoModes = await call('edit', { note: 'alpha', append: 'x', old_text: 'a', new_text: 'b' })
  assert.equal(twoModes.errorKind, 'usage')
  const stale = await call('edit', { note: 'alpha', old_text: 'beta', new_text: 'b' })
  assert.equal(stale.errorKind, 'usage')
  assert.match((stale.content[0] as { text: string }).text, /not found/)
})

test('reads page long notes and create opens the note in the calling window', async () => {
  const { store, bindings, call } = await setup()
  const long = store.create({ text: Array.from({ length: 3000 }, (_, index) => `line ${index + 1} ${'x'.repeat(20)}`).join('\n') })
  const first = json(await call('read', { note: long.id }))
  assert.equal(first.from, 1)
  assert.ok(typeof first.nextFromLine === 'number' && first.nextFromLine > 100)
  bindings.bind({ chatPaneId: 'chat-1', noteIds: [long.id], activeNoteId: long.id })
  const opened: Array<string | null | undefined> = []
  store.on('changed', (change) => opened.push(change.openInChat))
  const created = json(await call('create', { text: 'Summary\n- one' }))
  assert.equal(created.title, 'Summary')
  assert.equal(created.openedInWindow, true)
  assert.deepEqual(opened, ['chat-1'])
  const listed = json(await call('list', {}))
  assert.equal(listed.defaultNote, long.id)
  assert.equal((listed.window as unknown[]).length, 1)
})
