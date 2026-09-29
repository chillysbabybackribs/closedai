import { useEffect, useRef, useState, type JSX } from 'react'
import { EditorView } from '@codemirror/view'
import { openNoteSession, type NoteSession } from './note-sessions.js'

export type NoteCaret = { line: number; column: number; lines: number; chars: number; selected: number }

/**
 * The editor for one note. The buffer outlives the component (see note-sessions.ts), so this
 * only attaches a view to it, lands the caret in it, and reports where the caret is.
 */
export function NoteEditor({ noteId, focusOnOpen, onCaret, onError }: {
  noteId: string
  focusOnOpen: boolean
  onCaret: (caret: NoteCaret) => void
  onError: (reason: unknown) => void
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [missing, setMissing] = useState(false)
  const caretRef = useRef(onCaret)
  caretRef.current = onCaret
  const errorRef = useRef(onError)
  errorRef.current = onError

  useEffect(() => {
    let disposed = false
    let attached: { session: NoteSession; view: EditorView } | null = null
    void openNoteSession(noteId, (reason) => errorRef.current(reason)).then((session) => {
      if (disposed || !host.current) return
      if (!session) { setMissing(true); return }
      const view = new EditorView({
        state: session.state,
        parent: host.current,
        dispatchTransactions: (transactions, target) => {
          target.update(transactions)
          if (transactions.some((transaction) => transaction.docChanged || transaction.selection)) report(target)
        }
      })
      session.view = view
      attached = { session, view }
      report(view)
      if (focusOnOpen) view.focus()
    }, (reason: unknown) => errorRef.current(reason))
    const report = (view: EditorView): void => {
      const { state } = view
      const head = state.selection.main.head
      const line = state.doc.lineAt(head)
      const selected = state.selection.ranges.reduce((total, range) => total + range.to - range.from, 0)
      caretRef.current({ line: line.number, column: head - line.from + 1, lines: state.doc.lines, chars: state.doc.length, selected })
    }
    return () => {
      disposed = true
      if (!attached) return
      const { session, view } = attached
      session.state = view.state
      if (session.view === view) session.view = null
      view.destroy()
      void session.sync.flush()
    }
    // focusOnOpen only matters for the first attach of this note.
  }, [noteId])

  return missing
    ? <div className="notepad-missing">This note was deleted.</div>
    : <div ref={host} className="notepad-editor" data-ui="notepad.editor" data-ui-key={noteId} />
}
