import type { IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import type { NotepadBinding } from '../../shared/notes.js'
import type { NotepadBindings } from './notepad-bindings.js'
import type { NotesStore } from './notes-store.js'

// Same shape as the saved sites channels: the renderer names ids, the store owns the files.

export function registerNotesIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  getNotes: () => NotesStore | null,
  bindings: NotepadBindings,
  tagNotepadChat?: (chatPaneId: string) => void
): void {
  const store = (): NotesStore => {
    const notes = getNotes()
    if (!notes) throw new Error('Notes are not available yet')
    return notes
  }
  ipcMain.handle(IPC.invoke.notes.list, () => getNotes()?.list() ?? [])
  ipcMain.handle(IPC.invoke.notes.read, (_event, id: string) => getNotes()?.read(String(id)) ?? null)
  ipcMain.handle(IPC.invoke.notes.create, (_event, text: string) => store().create({ text: typeof text === 'string' ? text : '' }))
  ipcMain.handle(IPC.invoke.notes.save, (_event, id: string, text: string, baseRevision: number) => {
    if (typeof text !== 'string' || !Number.isSafeInteger(baseRevision)) throw new Error('Invalid note save')
    return store().save(String(id), text, baseRevision)
  })
  ipcMain.handle(IPC.invoke.notes.rename, (_event, id: string, title: string | null) =>
    store().rename(String(id), typeof title === 'string' ? title : null))
  ipcMain.handle(IPC.invoke.notes.remove, (_event, id: string) => getNotes()?.remove(String(id)))
  ipcMain.handle(IPC.invoke.notes.bind, (_event, binding: NotepadBinding) => {
    if (!binding || typeof binding.chatPaneId !== 'string' || !Array.isArray(binding.noteIds)) throw new Error('Invalid notepad binding')
    bindings.bind(binding)
    tagNotepadChat?.(binding.chatPaneId)
  })
  ipcMain.handle(IPC.invoke.notes.unbind, (_event, chatPaneId: string) => bindings.unbind(String(chatPaneId)))
}
