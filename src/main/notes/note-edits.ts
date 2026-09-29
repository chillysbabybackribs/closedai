import { noteLineCount, type NoteLineRange } from '../../shared/notes.js'

// The edits a model makes to a note, applied to the note's current text. Pure: the store applies
// the result under a new revision, and the tool reports the lines it wrote so the editor can mark
// them. Every failure is the caller's to fix (a stale quote, a line past the end), so it throws a
// NoteEditError the tool turns into a usage result rather than a tool fault.

export type NoteEdit =
  /** Replace an exact quote; it must occur once unless `all` is set. */
  | { kind: 'replace-text'; oldText: string; newText: string; all?: boolean }
  /** Replace 1-based lines `from`..`to` inclusive; `to = from - 1` inserts before `from`. */
  | { kind: 'replace-lines'; from: number; to: number; text: string }
  | { kind: 'append'; text: string }
  | { kind: 'rewrite'; text: string }

export type AppliedNoteEdit = { text: string; edited: NoteLineRange }

export class NoteEditError extends Error {
  override name = 'NoteEditError'
}

export function applyNoteEdit(text: string, edit: NoteEdit): AppliedNoteEdit {
  switch (edit.kind) {
    case 'replace-text': return replaceText(text, edit.oldText, edit.newText, edit.all === true)
    case 'replace-lines': return replaceLines(text, edit.from, edit.to, edit.text)
    case 'append': return append(text, edit.text)
    case 'rewrite': return { text: edit.text, edited: { from: 1, to: noteLineCount(edit.text) } }
  }
}

function replaceText(text: string, oldText: string, newText: string, all: boolean): AppliedNoteEdit {
  if (!oldText) throw new NoteEditError('old_text is empty; quote the exact text to replace, or use from_line/to_line')
  const first = text.indexOf(oldText)
  if (first < 0) throw new NoteEditError('old_text was not found in the note; read the note again and quote it exactly')
  const second = text.indexOf(oldText, first + oldText.length)
  if (second >= 0 && !all) {
    throw new NoteEditError('old_text occurs more than once; quote more surrounding text, or set replace_all')
  }
  const next = all ? text.split(oldText).join(newText) : text.slice(0, first) + newText + text.slice(first + oldText.length)
  const from = lineAt(text, first)
  const lastStart = all ? text.lastIndexOf(oldText) : first
  // Positions after the first replacement shift by the length change of each earlier one.
  const shift = all ? (occurrences(text, oldText) - 1) * (newText.length - oldText.length) : 0
  const endOffset = lastStart + shift + newText.length
  const to = Math.max(from, lineAt(next, Math.max(lastStart + shift, endOffset - 1)))
  return { text: next, edited: newText ? { from, to } : { from, to: from - 1 } }
}

function replaceLines(text: string, from: number, to: number, replacement: string): AppliedNoteEdit {
  const lines = text.split('\n')
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new NoteEditError('from_line and to_line must be whole numbers')
  if (from < 1 || from > lines.length + 1) {
    throw new NoteEditError(`from_line ${from} is outside the note, which has ${lines.length} lines`)
  }
  if (to < from - 1 || to > lines.length) {
    throw new NoteEditError(`to_line ${to} must be between ${from - 1} (insert) and ${lines.length}`)
  }
  const inserted = replacement === '' && to >= from ? [] : replacement.split('\n')
  const next = [...lines.slice(0, from - 1), ...inserted, ...lines.slice(to)]
  return {
    text: next.join('\n'),
    edited: inserted.length ? { from, to: from + inserted.length - 1 } : { from, to: from - 1 }
  }
}

function append(text: string, addition: string): AppliedNoteEdit {
  if (!addition) throw new NoteEditError('text is empty; there is nothing to append')
  const joiner = text && !text.endsWith('\n') ? '\n' : ''
  const next = text + joiner + addition
  const from = text ? noteLineCount(text) + (joiner ? 1 : 0) : 1
  return { text: next, edited: { from, to: noteLineCount(next) } }
}

function lineAt(text: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset && index < text.length; index += 1) if (text[index] === '\n') line += 1
  return line
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1
}
