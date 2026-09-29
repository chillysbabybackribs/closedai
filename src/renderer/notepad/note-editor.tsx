import { useEffect, useRef, useState, type JSX } from 'react'
import { EditorView } from '@codemirror/view'
import { openNoteSession, type NoteSession } from './note-sessions.js'

export type NoteCaret = { line: number; column: number; lines: number; chars: number; selected: number }

/**
 * The editor for one note. The buffer outlives the component (see note-sessions.ts), so this
 * only attaches a view to it, lands the caret in it, and reports where the caret is.
 */
export function NoteEditor({ noteId, active, onCaret, onError }: {
  noteId: string
  /** The tab is in front: the caret lands here when it comes forward. */
  active: boolean
  onCaret: (caret: NoteCaret) => void
  onError: (reason: unknown) => void
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [missing, setMissing] = useState(false)
  const caretRef = useRef(onCaret)
  caretRef.current = onCaret
  const errorRef = useRef(onError)
  errorRef.current = onError
  const activeRef = useRef(active)
  activeRef.current = active
  const [view, setView] = useState<EditorView | null>(null)

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
          if (activeRef.current && transactions.some((transaction) => transaction.docChanged || transaction.selection)) report(target)
        }
      })
      session.view = view
      attached = { session, view }
      setView(view)
      report(view)
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
      setView(null)
      if (!attached) return
      const { session, view } = attached
      session.state = view.state
      if (session.view === view) session.view = null
      view.destroy()
      void session.sync.flush()
    }
  }, [noteId])
  // Coming forward (or opening in front) puts the caret back in the note.
  useEffect(() => {
    if (!active || !view) return
    view.focus()
    const { state } = view
    const line = state.doc.lineAt(state.selection.main.head)
    caretRef.current({ line: line.number, column: state.selection.main.head - line.from + 1, lines: state.doc.lines,
      chars: state.doc.length, selected: 0 })
  }, [active, view])

  return missing
    ? <div className="notepad-missing">This note was deleted.</div>
    : <div ref={host} className="notepad-editor" data-ui="notepad.editor" data-ui-key={noteId} />
}
