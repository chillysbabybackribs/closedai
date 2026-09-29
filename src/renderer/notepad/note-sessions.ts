import { Annotation, EditorState, type ChangeSet, type StateEffect, type Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { NoteChange, NoteDoc } from '../../shared/notes.js'
import { clearEdited, markEdited, noteEditorExtensions } from './note-editor-setup.js'
import { onNoteChange } from './notes-client.js'
import { NoteSync } from './note-sync.js'

// One editing session per note for the life of the window: the buffer (with its undo history and
// selection) and its sync with main. A tab switch unmounts the editor but not the session, so
// coming back finds the caret where it was, and a model edit to a hidden note still lands in it.

export type NoteSession = {
  noteId: string
  state: EditorState
  view: EditorView | null
  sync: NoteSync
}

const sessions = new Map<string, NoteSession>()
const loading = new Map<string, Promise<NoteSession | null>>()
let routing = false

function route(): void {
  if (routing) return
  routing = true
  onNoteChange((change) => {
    const session = sessions.get(change.note.id)
    if (!session) return
    if (change.text === null) {
      session.sync.dispose()
      sessions.delete(change.note.id)
      return
    }
    session.sync.received(change)
  })
}

export function noteSession(noteId: string): NoteSession | null {
  return sessions.get(noteId) ?? null
}

/** The note's session, loading the note from main the first time. */
export function openNoteSession(noteId: string, onError: (reason: unknown) => void): Promise<NoteSession | null> {
  route()
  const existing = sessions.get(noteId)
  if (existing) return Promise.resolve(existing)
  let pending = loading.get(noteId)
  if (!pending) {
    pending = window.closedai.notes.read(noteId).then((note) => note ? createSession(note, onError) : null)
      .finally(() => loading.delete(noteId))
    loading.set(noteId, pending)
  }
  return pending
}

function createSession(note: NoteDoc, onError: (reason: unknown) => void): NoteSession {
  const raced = sessions.get(note.id)
  if (raced) return raced
  const session: NoteSession = { noteId: note.id, state: null as unknown as EditorState, view: null, sync: null as unknown as NoteSync }
  session.sync = new NoteSync(note.id, note, {
    save: (id, text, base) => window.closedai.notes.save(id, text, base),
    doc: () => current(session).doc,
    applyRemote: (changes, change) => applyRemote(session, changes, change),
    onError
  })
  session.state = EditorState.create({
    doc: note.text,
    extensions: noteEditorExtensions(EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      // Only the user's own typing is unsaved; a remote change is already main's.
      const typed = update.transactions.filter((transaction: Transaction) => !transaction.annotation(remoteChange))
      for (const transaction of typed) if (transaction.docChanged) session.sync.typed(transaction.changes)
    }))
  })
  sessions.set(note.id, session)
  return session
}

/** Marks a transaction that carries main's change rather than the user's typing. */
const remoteChange = Annotation.define<boolean>()

function current(session: NoteSession): EditorState {
  return session.view?.state ?? session.state
}

function applyRemote(session: NoteSession, changes: ChangeSet, change: NoteChange): void {
  const effects: StateEffect<unknown>[] = []
  if (change.edited && change.text !== null && change.edited.to >= change.edited.from) {
    const { from, to } = lineSpan(change.text, change.edited.from, change.edited.to)
    effects.push(markEdited.of([{ from: session.sync.toBuffer(from), to: session.sync.toBuffer(to) }]))
  }
  const spec = { changes, effects, annotations: remoteChange.of(true) }
  if (session.view) session.view.dispatch(spec)
  else session.state = session.state.update(spec).state
}

/** Clear the marks of the last task's edits, e.g. when a new task starts. */
export function clearEditedMarks(noteIds: readonly string[]): void {
  for (const id of noteIds) {
    const session = sessions.get(id)
    if (!session) continue
    const spec = { effects: clearEdited.of(null) }
    if (session.view) session.view.dispatch(spec)
    else session.state = session.state.update(spec).state
  }
}

/** Offsets of the start of line `from` and the end of line `to` (1-based) in `text`. */
function lineSpan(text: string, from: number, to: number): { from: number; to: number } {
  let line = 1
  let start = 0
  let end = text.length
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\n') continue
    line += 1
    if (line === from) start = index + 1
    if (line === to + 1) { end = index; break }
  }
  return { from: from <= 1 ? 0 : start, to: end }
}
