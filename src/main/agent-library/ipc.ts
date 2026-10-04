import type { IpcMain } from 'electron'
import type { SavedAgentDraft, SavedAgentPatch } from '../../shared/agent-library.js'
import type { AgentOptimizeRequest } from '../../shared/agent-optimizer.js'
import { IPC } from '../../shared/ipc-channels.js'
import type { AgentLibraryStore } from './agent-library-store.js'
import type { AgentPromptOptimizer } from './prompt-optimizer.js'

// Same shape as the saved-sites channels: the renderer names ids, the store owns the file.
// Run bookkeeping (lastRunAt, runCount) is not a channel; the run service reports starts.
// Optimize is a request to a model, not a library write: its result goes back to the editor.

export function registerAgentLibraryIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  getLibrary: () => AgentLibraryStore | null,
  getOptimizer: () => AgentPromptOptimizer | null = () => null
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
  ipcMain.handle(IPC.invoke.agentLibrary.optimize, (_event, request: AgentOptimizeRequest) => {
    const optimizer = getOptimizer()
    if (!optimizer) throw new Error('Optimizing is not available until the chat workspace has started')
    return optimizer.optimize(request)
  })
  ipcMain.handle(IPC.invoke.agentLibrary.cancelOptimize, (_event, requestId: string) => getOptimizer()?.cancel(requestId))
}
