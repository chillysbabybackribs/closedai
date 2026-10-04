import { useCallback, useContext, useEffect, useLayoutEffect, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react'
import { ChevronUp, FilePlus2, Trash2 } from '../icons/index.js'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from '../../components/ui/dropdown-menu.js'
import type { NoteMeta } from '../../shared/notes.js'
import { NoteEditor, type NoteCaret } from './note-editor.js'
import { NotepadChat, toggleFocusedNotepadChat } from './notepad-chat.js'
import { NotepadHostContext, type NotepadHost } from './notepad-host.js'
import { noteIdOfTab, tileNoteIds, tileNotepadChat } from './notepad-layout.js'
import { useNotes } from './notes-client.js'

const NOTES_MENU_LIMIT = 30

/**
 * A note tab's body: the editor, the status line under it, and the window's chat floating over
 * the notes. Everything a window shares (its chat, its tabs) is read from the tile it lives in.
 * Every tab of a tile stays mounted; only the one in front speaks for the window (`active`).
 */
export function NotepadView({ tabId, active }: { tabId: string; active: boolean }): JSX.Element | null {
  const host = useContext(NotepadHostContext)
  const noteId = noteIdOfTab(tabId)
  const notes = useNotes()
  const [caret, setCaret] = useState<NoteCaret | null>(null)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const windowNoteIds = host ? tileNoteIds(host.tree, tabId) : []
  const windowKey = windowNoteIds.join('\0')
  const savedChat = host ? tileNotepadChat(host.tree, tabId) : null
  const chatId = savedChat && host?.chats.some((row) => row.paneId === savedChat) ? savedChat : null

  // Main reads which notes the window's chat is about when a turn is sent and when a tool runs.
  useEffect(() => {
    if (!chatId || !noteId || !active) return
    void window.closedai.notes.bind({ chatPaneId: chatId, noteIds: windowKey.split('\0').filter(Boolean), activeNoteId: noteId })
  }, [active, chatId, noteId, windowKey])
  // The chat card sizes itself from the notes it floats over, as the quick chat does from the page.
  useLayoutEffect(() => {
    if (!root) return
    const body = root.querySelector('.notepad-body')
    if (!body) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) })
    })
    observer.observe(body)
    return () => observer.disconnect()
  }, [root])
  // In a window of its own no main-process shortcut reaches this renderer, so Ctrl+J is caught here.
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'j') return
    if (toggleFocusedNotepadChat()) event.preventDefault()
  }, [])

  if (!host || !noteId) return null
  const title = (id: string): string => notes.find((note) => note.id === id)?.title ?? 'Note'
  const style = { '--page-width': `${size.width}px`, '--page-height': `${size.height}px` } as CSSProperties
  return <section ref={setRoot} className="notepad-view" data-ui="view.note" data-ui-key={tabId} aria-label={`Note ${title(noteId)}`}
    onKeyDown={onKeyDown}>
    <div className="notepad-body" style={style}>
      <NoteEditor key={noteId} noteId={noteId} active={active} onCaret={setCaret} onError={host.onError} />
      {active ? <NotepadChat host={host} tabId={tabId} noteId={noteId} windowNoteIds={windowNoteIds} chatId={chatId}
        noteTitle={title} root={root} /> : null}
    </div>
    <NotepadStatus host={host} tabId={tabId} noteId={noteId} caret={caret} notes={notes} windowNoteIds={windowNoteIds} />
  </section>
}

function NotepadStatus({ host, tabId, noteId, caret, notes, windowNoteIds }: {
  host: NotepadHost
  tabId: string
  noteId: string
  caret: NoteCaret | null
  notes: NoteMeta[]
  windowNoteIds: string[]
}): JSX.Element {
  const others = notes.filter((note) => !windowNoteIds.includes(note.id)).slice(0, NOTES_MENU_LIMIT)
  const deleteNote = (): void => {
    void window.closedai.notes.remove(noteId).catch(host.onError)
  }
  return <footer className="notepad-status">
    <span className="notepad-status-item" data-ui="notepad.caret">
      {caret ? `Ln ${caret.line}, Col ${caret.column}` : 'Ln 1, Col 1'}
      {caret?.selected ? ` (${caret.selected} selected)` : ''}
    </span>
    <span className="notepad-status-item">{caret ? `${caret.lines} ${caret.lines === 1 ? 'line' : 'lines'}` : ''}</span>
    <span className="notepad-status-item">Markdown</span>
    <span className="notepad-status-item notepad-status-saved" title="Notes save as you type and survive restarts">Saved automatically</span>
    <span className="notepad-status-spacer" />
    <button type="button" className="notepad-status-button" data-ui="notepad.new" title="New note"
      onClick={() => { void host.newNote(tabId) }}>
      <FilePlus2 size={13} aria-hidden="true" /><span>New</span>
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="notepad-status-button" data-ui="notepad.notes" title="All notes">
          <span>Notes</span><ChevronUp size={13} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-[280px]">
        <DropdownMenuLabel>{others.length ? 'Open another note' : 'Every note is open here'}</DropdownMenuLabel>
        {others.map((note) => (
          <DropdownMenuItem key={note.id} data-ui="notepad.open-note" data-ui-key={note.id} onSelect={() => host.openNote(note.id, tabId)}>
            <span className="notepad-menu-title">{note.title}</span>
            <span className="notepad-menu-meta">{note.lineCount} {note.lineCount === 1 ? 'line' : 'lines'}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem data-ui="notepad.delete" onSelect={deleteNote}>
          <Trash2 size={14} aria-hidden="true" /><span>Delete this note</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </footer>
}
