import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { MessageSquareMore } from 'lucide-react'
import { chatRunning } from '../chat-state.js'
import { useWorkspacePaneSlice } from '../chat-layout/workspace-pane-subscription.js'
import { QuickChatCard, type QuickChatMode, type QuickChatRequest } from '../quick-chat-overlay/quick-chat-card.js'
import { quickChatFeed } from '../quick-chat-overlay/quick-chat-feed.js'
import type { NotepadHost } from './notepad-host.js'
import { clearEditedMarks } from './note-sessions.js'

// A notepad window's chat floats over its notes, like the browser's quick chat over a page: a
// round button, or the card. One chat per window, made the first time it opens. A task stays on
// the note it started on; switching tabs while it runs shrinks the card to its status line.
// Otherwise the card changes shape only when the user asks.

/** Kept per chat outside React: a tab switch remounts the note view, and with it this component. */
type ChatUi = { open: boolean; mode: QuickChatMode; taskNoteId: string | null; noteId: string | null }
const ui = new Map<string, ChatUi>()
const uiFor = (key: string): ChatUi => ui.get(key) ?? { open: false, mode: 'full', taskNoteId: null, noteId: null }

/** Ctrl+J for the notepad the keyboard is in; main routes the shortcut to the window's renderer. */
const toggles = new Map<HTMLElement, () => void>()
export function toggleFocusedNotepadChat(): boolean {
  const active = document.activeElement
  for (const [element, toggle] of toggles) {
    if (active instanceof Node && element.contains(active)) { toggle(); return true }
  }
  return false
}

export function NotepadChat({ host, tabId, noteId, windowNoteIds, chatId, noteTitle, root }: {
  host: NotepadHost
  tabId: string
  noteId: string
  windowNoteIds: string[]
  chatId: string | null
  noteTitle: (id: string) => string
  /** The notepad view, whose focus decides where Ctrl+J goes. */
  root: HTMLElement | null
}): JSX.Element {
  const key = chatId ?? `pending:${tabId}`
  const [state, setState] = useState<ChatUi>(() => uiFor(key))
  const update = useCallback((change: Partial<ChatUi>) => {
    const next = { ...uiFor(key), ...change }
    ui.set(key, next)
    setState(next)
  }, [key])
  useEffect(() => { setState(uiFor(key)) }, [key])
  const slice = useWorkspacePaneSlice(chatId ?? '')
  const running = chatId !== null && slice.state !== undefined && chatRunning(slice.state)
  const [creating, setCreating] = useState(false)

  // A task starts on the note in front: it keeps that note, and the last task's marks go.
  const wasRunning = useRef(running)
  useEffect(() => {
    if (running && !wasRunning.current) {
      update({ taskNoteId: noteId })
      clearEditedMarks(windowNoteIds)
    }
    wasRunning.current = running
  }, [running])
  // Switching tabs while it runs leaves the task where it was and shrinks the card out of the way.
  useEffect(() => {
    const seen = uiFor(key)
    if (seen.noteId === noteId) return
    update({ noteId, ...(seen.noteId !== null && running && seen.mode === 'full' ? { mode: 'compact' as const } : {}) })
  }, [noteId, key])

  const open = useCallback(async () => {
    if (chatId) { update({ open: true }); return }
    if (creating) return
    setCreating(true)
    try {
      const id = await host.newChat()
      ui.set(id, { ...uiFor(key), open: true, noteId })
      host.setWindowChat(tabId, id)
    } catch (reason) {
      host.onError(reason)
    } finally {
      setCreating(false)
    }
  }, [chatId, creating, host, key, noteId, tabId, update])
  const request = useCallback((value: QuickChatRequest) => {
    if (value === 'close') { update({ open: false }); return }
    void (async () => {
      try {
        const id = await host.newChat()
        ui.set(id, { open: true, mode: 'full', taskNoteId: null, noteId })
        host.setWindowChat(tabId, id)
        if (chatId) {
          void window.closedai.notes.unbind(chatId)
          await host.closeChat(chatId)
        }
      } catch (reason) {
        host.onError(reason)
      }
    })()
  }, [chatId, host, noteId, tabId, update])

  useEffect(() => {
    if (!root) return
    const toggle = (): void => { if (uiFor(key).open) update({ open: false }); else void open() }
    toggles.set(root, toggle)
    return () => { toggles.delete(root) }
  }, [root, key, open, update])

  const taskNote = running ? state.taskNoteId ?? noteId : noteId
  const subject = noteTitle(taskNote)
  const elsewhere = running && state.taskNoteId !== null && state.taskNoteId !== noteId
  return <div className="notepad-chat-layer quick-chat-layer" data-open={state.open && chatId ? 'true' : 'false'}>
    {elsewhere ? (
      <div className="notepad-chat-elsewhere" role="status">
        <span>The task stays on <b>{noteTitle(state.taskNoteId!)}</b>.</span>
        <button type="button" data-ui="notepad.chat-go-to-task" onClick={() => host.openNote(state.taskNoteId!, tabId)}>Go to it</button>
      </div>
    ) : null}
    {state.open && chatId ? (
      <QuickChatCard key={chatId} paneId={chatId} site={subject} dispatch={host.dispatch} appearance={host.appearance}
        surface="notepad" onRequest={request} mode={state.mode} onModeChange={(mode) => update({ mode })} />
    ) : (
      <NotepadChatButton chatId={chatId} subject={subject} busy={creating} onOpen={() => { void open() }} />
    )}
  </div>
}

/** The closed chat: a ring and the note's name while its task runs, "Done in …" once it ends. */
function NotepadChatButton({ chatId, subject, busy, onOpen }: {
  chatId: string | null
  subject: string
  busy: boolean
  onOpen: () => void
}): JSX.Element {
  const slice = useWorkspacePaneSlice(chatId ?? '')
  const state = chatId !== null ? slice.state : undefined
  const running = state !== undefined && chatRunning(state)
  const [ended, setEnded] = useState(false)
  const wasRunning = useRef(running)
  useEffect(() => {
    if (running) setEnded(false)
    else if (wasRunning.current) setEnded(true)
    wasRunning.current = running
  }, [running])
  const status = ended && state ? quickChatFeed(state, 1).status : null
  const label = running ? subject : status === 'done' ? `Done in ${subject}` : status === 'failed' ? `Stopped in ${subject}` : null
  return (
    <button type="button" className={`quick-chat-fab${running ? ' is-running' : ''}`} data-ui="notepad.chat"
      disabled={busy} title={running ? `Working on ${subject} (Ctrl+J)` : 'Chat about this note (Ctrl+J)'}
      aria-label={label ? `Open the note chat: ${label}` : 'Open the note chat'} onClick={onOpen}>
      {label ? <span className={`quick-chat-fab-label${status ? ` is-${status}` : ''}`}>{label}</span> : null}
      <span className="quick-chat-fab-disc"><MessageSquareMore size={19} aria-hidden="true" /></span>
    </button>
  )
}
