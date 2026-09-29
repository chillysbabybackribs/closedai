// Notes: plain-text buffers the notepad window edits and chats read and write. Main owns the text
// (one file per note); the renderer holds an editor over it and saves against a revision, so a
// model edit that lands between two keystrokes is never overwritten by the stale buffer.

export type NoteMeta = {
  id: string
  /** The first non-empty line, until the user names the note. */
  title: string
  /** True once the user named the note; the title then stops following the first line. */
  named: boolean
  createdAt: number
  updatedAt: number
  /** Bumped by every accepted write, from the editor or a model. */
  revision: number
  lineCount: number
}

export type NoteDoc = NoteMeta & { text: string }

/** A range of 1-based lines, inclusive; `to < from` names an insertion point before `from`. */
export type NoteLineRange = { from: number; to: number }

export type NoteChange = {
  note: NoteMeta
  /** The note's whole text after the change; null when the note was deleted. */
  text: string | null
  origin: 'editor' | 'model'
  /** Lines a model edit wrote, in the new text; the editor marks them. */
  edited?: NoteLineRange | null
  /** The chat whose notepad window should show the note, when a model created it there. */
  openInChat?: string | null
}

/** A save the store refused because the note moved on; the caller rebases onto `note`. */
export type NoteSaveResult = { ok: true; note: NoteMeta } | { ok: false; note: NoteDoc }

/**
 * What a notepad window tells main about its chat: the notes open in the window, in tab order,
 * and which one the user is looking at. The chat's turn context and the notes tools read it.
 */
export type NotepadBinding = {
  chatPaneId: string
  noteIds: string[]
  activeNoteId: string | null
}

export const NOTE_TITLE_CHARS = 60
export const UNTITLED_NOTE = 'Untitled'

/** The title a note shows until the user names it. */
export function derivedNoteTitle(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|>\s*)/, '').trim()
    if (line) return line.length > NOTE_TITLE_CHARS ? `${line.slice(0, NOTE_TITLE_CHARS - 1).trimEnd()}…` : line
  }
  return UNTITLED_NOTE
}

export function noteLineCount(text: string): number {
  return text.length === 0 ? 1 : text.split('\n').length
}
