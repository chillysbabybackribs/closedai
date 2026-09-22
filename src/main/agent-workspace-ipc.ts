import type { IpcMain } from 'electron'
import type { AgentWorkspaceBounds } from '../shared/types.js'
import { IPC } from '../shared/ipc-channels.js'
import type { AgentWorkspaceSurface } from './agent-workspace-surface.js'

export function registerAgentWorkspaceIpc(ipcMain: Pick<IpcMain, 'handle'>, getSurface: () => AgentWorkspaceSurface | null): void {
  ipcMain.handle(IPC.invoke.agentWorkspace.setBounds, (_event, bounds: AgentWorkspaceBounds) => getSurface()?.setBounds(bounds))
}
