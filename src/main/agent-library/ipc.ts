import type { IpcMain } from 'electron'
import type { SavedAgentDraft, SavedAgentPatch } from '../../shared/agent-library.js'
import { IPC } from '../../shared/ipc-channels.js'
import type { AgentLibraryStore } from './agent-library-store.js'

// Same shape as the saved-sites channels: the renderer names ids, the store owns the file.
// Run bookkeeping (lastRunAt, runCount) is not a channel; the run service reports starts.

export function registerAgentLibraryIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  getLibrary: () => AgentLibraryStore | null
): void {
  const requireLibrary = (): AgentLibraryStore => {
    const library = getLibrary()
    if (!library) throw new Error('The agent library is not available yet')
    return library
  }
  ipcMain.handle(IPC.invoke.agentLibrary.list, () => getLibrary()?.list() ?? [])
  ipcMain.handle(IPC.invoke.agentLibrary.save, (_event, draft: SavedAgentDraft) => requireLibrary().save(draft))
  ipcMain.handle(IPC.invoke.agentLibrary.update, (_event, id: string, patch: SavedAgentPatch) => requireLibrary().update(id, patch))
  ipcMain.handle(IPC.invoke.agentLibrary.remove, (_event, id: string) => requireLibrary().remove(id))
}
