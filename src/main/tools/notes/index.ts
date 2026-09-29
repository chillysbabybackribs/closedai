import type { NoteDoc } from '../../../shared/notes.js'
import { NoteEditError, type NoteEdit } from '../../notes/note-edits.js'
import type { NotepadBindings } from '../../notes/notepad-bindings.js'
import type { NotesStore } from '../../notes/notes-store.js'
import { jsonResult, objectSchema } from '../json-result.js'
import {
  booleanArg, defineTool, numberArg, stringArg, usageResult,
  type JsonObject, type ToolContext, type ToolDefinition, type ToolNamespace, type ToolResult
} from '../tool.js'

// The notepad's notes, for any chat. A chat that belongs to a notepad window is about that
// window's notes: its turn carries the active note (closedai.notepad), and a call that names no
// note means the note the turn started on, even after the user switches tabs.

/** Numbered text a read returns before it stops and names the next line to ask for. */
const READ_CHARS = 12_000
const PREVIEW_LINES = 30
const LIST_LIMIT = 50

export type NotesToolHost = { store: () => NotesStore | null; bindings: NotepadBindings }

const NOTE_ARG = {
  type: 'string',
  maxLength: 200,
  description: 'Note id, or its title (exact, any case, or a unique prefix). Omit for the note this notepad chat is about.'
}

export function notesTools(host: NotesToolHost): ToolNamespace {
  return {
    name: 'notes',
    description:
      'Plain-text notes in the ClosedAI notepad. A chat opened from a notepad window is about its active note: ' +
      'the turn carries that note with line numbers (closedai.notepad), and these tools default to it. Edits appear ' +
      'live in the user\'s editor, with the lines you wrote marked.',
    tools: [listTool(host), readTool(host), editTool(host), createTool(host)]
  }
}

function listTool(host: NotesToolHost): ToolDefinition {
  return defineTool({
    name: 'list',
    description: 'List notes, most recently changed first, and the tabs of the calling chat\'s notepad window.',
    inputSchema: objectSchema({
      query: { type: 'string', maxLength: 200, description: 'Optional case-insensitive filter over titles.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: `Most notes to return (default ${LIST_LIMIT}).` }
    }),
    run: async (input, context) => {
      const store = requireStore(host)
      const query = stringArg(input, 'query', '')!.trim().toLowerCase()
      const limit = Math.trunc(numberArg(input, 'limit', LIST_LIMIT))
      const binding = host.bindings.get(context.paneId)
      const all = store.list().filter((note) => !query || note.title.toLowerCase().includes(query))
      return jsonResult({
        defaultNote: host.bindings.defaultNoteId(context.paneId),
        ...(binding ? {
          window: binding.noteIds.flatMap((id) => {
            const note = store.read(id)
            return note ? [{ id, title: note.title, lines: note.lineCount, active: id === binding.activeNoteId }] : []
          })
        } : {}),
        count: all.length,
        notes: all.slice(0, limit).map((note) => ({
          id: note.id, title: note.title, lines: note.lineCount, updatedAt: new Date(note.updatedAt).toISOString()
        }))
      })
    }
  })
}

function readTool(host: NotesToolHost): ToolDefinition {
  return defineTool({
    name: 'read',
    description:
      'Read a note as numbered lines ("12| text"). Long notes stop at a budget and name `nextFromLine`. ' +
      'The turn context already holds a small active note in full; read it again only after it may have changed.',
    inputSchema: objectSchema({
      note: NOTE_ARG,
      from_line: { type: 'integer', minimum: 1, description: 'First line to return (default 1).' },
      to_line: { type: 'integer', minimum: 1, description: 'Last line to return (default: as far as the budget allows).' }
    }),
    run: async (input, context) => withNote(host, input, context, (note) => {
      const lines = note.text.split('\n')
      const from = Math.max(1, Math.trunc(numberArg(input, 'from_line', 1)))
      const to = Math.min(lines.length, Math.trunc(numberArg(input, 'to_line', lines.length)))
      if (from > lines.length) return usageResult(`from_line ${from} is past the end; the note has ${lines.length} lines`)
      const shown: string[] = []
      let used = 0
      let line = from
      for (; line <= to; line += 1) {
        const row = `${line}| ${lines[line - 1]}`
        if (shown.length && used + row.length > READ_CHARS) break
        shown.push(row.length > READ_CHARS ? `${row.slice(0, READ_CHARS)}…` : row)
        used += row.length + 1
      }
      return jsonResult({
        ...noteHeader(note),
        from, to: line - 1,
        ...(line <= to ? { nextFromLine: line } : {}),
        text: shown.join('\n')
      })
    })
  })
}

function editTool(host: NotesToolHost): ToolDefinition {
  return defineTool({
    name: 'edit',
    description:
      'Change a note. Give exactly one of: `old_text` + `new_text` (an exact quote, unique unless `replace_all`); ' +
      '`from_line` + `to_line` + `text` (replace those lines; `to_line` = `from_line` - 1 inserts before `from_line`, ' +
      'empty `text` deletes them); `append`; or `text` + `replace_whole: true`. Line numbers are the current note\'s: ' +
      'each result returns the new line count, so make several edits bottom-up or re-read between them. The user sees ' +
      'each edit land in their editor.',
    inputSchema: objectSchema({
      note: NOTE_ARG,
      old_text: { type: 'string', description: 'Exact text to replace.' },
      new_text: { type: 'string', description: 'Replacement for `old_text`.' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence of `old_text`.' },
      from_line: { type: 'integer', minimum: 1 },
      to_line: { type: 'integer', minimum: 0 },
      text: { type: 'string', description: 'New lines for `from_line`..`to_line`, or the whole note with `replace_whole`.' },
      append: { type: 'string', description: 'Text added as new lines at the end.' },
      replace_whole: { type: 'boolean', description: 'Replace the entire note with `text`.' }
    }),
    run: async (input, context) => withNote(host, input, context, (note) => {
      const edit = editFrom(input)
      if (typeof edit === 'string') return usageResult(edit)
      const { note: next, applied } = requireStore(host).edit(note.id, edit)
      const lines = next.text.split('\n')
      const last = Math.min(applied.edited.to, applied.edited.from + PREVIEW_LINES - 1)
      return jsonResult({
        ...noteHeader(next),
        edited: { fromLine: applied.edited.from, toLine: applied.edited.to },
        written: lines.slice(applied.edited.from - 1, last).map((line, index) => `${applied.edited.from + index}| ${line}`).join('\n')
      })
    })
  })
}

function createTool(host: NotesToolHost): ToolDefinition {
  return defineTool({
    name: 'create',
    description:
      'Create a note. From a notepad window\'s chat it opens as a new tab in that window; the user\'s active tab stays put.',
    inputSchema: objectSchema({
      text: { type: 'string', description: 'The note\'s text.' },
      title: { type: 'string', maxLength: 60, description: 'Optional name; otherwise the first line is the title.' }
    }),
    run: async (input, context) => {
      const binding = host.bindings.get(context.paneId)
      const note = requireStore(host).create(
        { text: stringArg(input, 'text', '')!, title: stringArg(input, 'title') ?? null },
        'model',
        binding ? binding.chatPaneId : null
      )
      return jsonResult({ ...noteHeader(note), openedInWindow: Boolean(binding) })
    }
  })
}

function editFrom(input: JsonObject): NoteEdit | string {
  const oldText = stringArg(input, 'old_text')
  const newText = stringArg(input, 'new_text')
  const text = stringArg(input, 'text')
  const append = stringArg(input, 'append')
  const whole = booleanArg(input, 'replace_whole', false)
  const hasLines = input.from_line !== undefined || input.to_line !== undefined
  const modes = [oldText !== undefined, hasLines, append !== undefined, whole].filter(Boolean).length
  if (modes !== 1) return 'Give exactly one edit: old_text + new_text, from_line + to_line + text, append, or text + replace_whole.'
  if (oldText !== undefined) {
    if (newText === undefined) return 'old_text needs new_text (use an empty string to delete the quote).'
    return { kind: 'replace-text', oldText, newText, all: booleanArg(input, 'replace_all', false) }
  }
  if (hasLines) {
    if (input.from_line === undefined || input.to_line === undefined || text === undefined) {
      return 'A line edit needs from_line, to_line and text.'
    }
    return { kind: 'replace-lines', from: numberArg(input, 'from_line', 1), to: numberArg(input, 'to_line', 0), text }
  }
  if (append !== undefined) return { kind: 'append', text: append }
  if (text === undefined) return 'replace_whole needs text.'
  return { kind: 'rewrite', text }
}

function withNote(host: NotesToolHost, input: JsonObject, context: ToolContext, run: (note: NoteDoc) => ToolResult): Promise<ToolResult> {
  const store = requireStore(host)
  const reference = stringArg(input, 'note')?.trim() || host.bindings.defaultNoteId(context.paneId)
  if (!reference) {
    return Promise.resolve(usageResult('Name a note: this chat has no notepad window. notes.list shows ids and titles.'))
  }
  const note = store.find(reference)
  if (!note) return Promise.resolve(usageResult(`No single note matches "${reference}"; notes.list shows ids and titles.`))
  try {
    return Promise.resolve(run(note))
  } catch (error) {
    if (error instanceof NoteEditError) return Promise.resolve(usageResult(error.message))
    throw error
  }
}

function noteHeader(note: NoteDoc): JsonObject {
  return { id: note.id, title: note.title, revision: note.revision, lines: note.lineCount }
}

function requireStore(host: NotesToolHost): NotesStore {
  const store = host.store()
  if (!store) throw new Error('Notes are not available yet')
  return store
}
