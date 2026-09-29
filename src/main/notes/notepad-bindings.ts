import type { NoteDoc, NotepadBinding } from '../../shared/notes.js'
import type { NotepadTurnContext } from '../chat-context/turn-context.js'

// Which notes each notepad window's chat is about. The window reports its tabs and active note;
// a turn pins the note it started on, so a task keeps editing that note when the user switches
// tabs, and the notes tools default to it.

/** Past these the turn carries the note's outline, and the model reads the rest with notes.read. */
const INLINE_NOTE_CHARS = 12_000
const INLINE_NOTE_LINES = 400
const EXCERPT_LINES = 120
const EXCERPT_LINE_CHARS = 400

type Binding = NotepadBinding & { taskNoteId: string | null }

export class NotepadBindings {
  private readonly bindings = new Map<string, Binding>()

  bind(binding: NotepadBinding): void {
    const noteIds = [...new Set(binding.noteIds.filter((id) => typeof id === 'string' && id))].slice(0, 200)
    const activeNoteId = binding.activeNoteId && noteIds.includes(binding.activeNoteId) ? binding.activeNoteId : noteIds[0] ?? null
    const previous = this.bindings.get(binding.chatPaneId)
    this.bindings.set(binding.chatPaneId, {
      chatPaneId: binding.chatPaneId, noteIds, activeNoteId, taskNoteId: previous?.taskNoteId ?? null
    })
  }

  unbind(chatPaneId: string): void {
    this.bindings.delete(chatPaneId)
  }

  get(chatPaneId: string | null | undefined): Binding | null {
    return chatPaneId ? this.bindings.get(chatPaneId) ?? null : null
  }

  /** The note a tool call means when it names none: the one this turn started on. */
  defaultNoteId(chatPaneId: string | null | undefined): string | null {
    const binding = this.get(chatPaneId)
    return binding?.taskNoteId ?? binding?.activeNoteId ?? null
  }

  /**
   * The context a notepad chat's turn carries: the active note (whole, when it is small) and the
   * window's other tabs. Called as the turn is sent, so it also pins the turn to that note.
   */
  turnContext(chatPaneId: string, read: (id: string) => NoteDoc | null): NotepadTurnContext | null {
    const binding = this.bindings.get(chatPaneId)
    if (!binding) return null
    binding.taskNoteId = binding.activeNoteId
    const active = binding.activeNoteId ? read(binding.activeNoteId) : null
    const others = binding.noteIds.filter((id) => id !== binding.activeNoteId).flatMap((id) => {
      const note = read(id)
      return note ? [{ id: note.id, title: note.title, lines: note.lineCount }] : []
    })
    return {
      surface: 'notepad',
      activeNote: active ? noteForTurn(active) : null,
      otherTabs: others
    }
  }
}

function noteForTurn(note: NoteDoc): NotepadTurnContext['activeNote'] {
  const lines = note.text.split('\n')
  const whole = note.text.length <= INLINE_NOTE_CHARS && lines.length <= INLINE_NOTE_LINES
  const shown = whole ? lines : lines.slice(0, EXCERPT_LINES).map((line) =>
    line.length > EXCERPT_LINE_CHARS ? `${line.slice(0, EXCERPT_LINE_CHARS)}…` : line)
  return {
    id: note.id,
    title: note.title,
    lines: note.lineCount,
    revision: note.revision,
    text: shown.map((line, index) => `${index + 1}| ${line}`).join('\n'),
    ...(whole ? {} : { truncated: `Only lines 1-${shown.length} of ${lines.length} are shown; read the rest with notes.read.` })
  }
}
