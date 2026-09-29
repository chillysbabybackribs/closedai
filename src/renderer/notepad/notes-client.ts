import { useSyncExternalStore } from 'react'
import type { NoteChange, NoteMeta } from '../../shared/notes.js'

// The renderer's view of the notes main keeps: every note's title and size for tab strips and
// lists, and each change as it lands, for the editor showing that note. One subscription to main
// per window, started on first use.

let notes: NoteMeta[] = []
let started = false
const listListeners = new Set<() => void>()
const changeListeners = new Set<(change: NoteChange) => void>()

function start(): void {
  if (started || typeof window === 'undefined' || !window.closedai?.notes) return
  started = true
  window.closedai.notes.onChanged((change) => {
    const rest = notes.filter((note) => note.id !== change.note.id)
    notes = change.text === null ? rest : [change.note, ...rest].sort((a, b) => b.updatedAt - a.updatedAt)
    for (const listener of listListeners) listener()
    for (const listener of changeListeners) listener(change)
  })
  void window.closedai.notes.list().then((listed) => {
    // A change that arrived first is newer than the listing that raced it.
    const known = new Map(notes.map((note) => [note.id, note]))
    notes = listed.map((note) => known.get(note.id) ?? note)
    for (const listener of listListeners) listener()
  })
}

function subscribe(listener: () => void): () => void {
  start()
  listListeners.add(listener)
  return () => listListeners.delete(listener)
}

/** Every note, most recently changed first. */
export function useNotes(): NoteMeta[] {
  return useSyncExternalStore(subscribe, () => notes)
}

export function noteMeta(id: string): NoteMeta | null {
  return notes.find((note) => note.id === id) ?? null
}

/** Every change main accepts, from any editor or model. */
export function onNoteChange(listener: (change: NoteChange) => void): () => void {
  start()
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}
