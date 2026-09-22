import type { IpcMain } from 'electron'

import { PEER_READ_MAX_CHARS, type PeerChatReadResult } from '../shared/chat-peers.js'
import { IPC } from '../shared/ipc-channels.js'
import type { ProjectMutation } from '../shared/project/mutations.js'
import type { ChatPeerManager } from './chat-peers/peer-manager.js'
import type { ProjectHub } from './project-store/project-hub.js'

/** Transcript items a task node shows for its worker before the user asks for more. */
const WORKER_LOG_LIMIT = 20

export function registerProjectIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  hub: () => ProjectHub | null,
  chat: () => ChatPeerManager | null
): void {
  const ready = (): ProjectHub => {
    const service = hub()
    if (!service) throw new Error('Project service is not ready')
    return service
  }
  ipcMain.handle(IPC.invoke.project.snapshot, async (_event, projectPath: string) => ready().snapshot(projectPath))
  ipcMain.handle(IPC.invoke.project.mutate, async (_event, projectPath: string, mutations: ProjectMutation[]) =>
    ready().mutate(projectPath, Array.isArray(mutations) ? mutations : []))
  // A task node shows the worker carrying it. The read is the same bounded page a peer chat
  // serves a model, so a parked worker answers from its saved tail instead of being woken.
  ipcMain.handle(IPC.invoke.project.workerLog, async (_event, chatId: string, limit: number): Promise<PeerChatReadResult | null> => {
    const service = chat()
    if (!service || typeof chatId !== 'string' || !chatId) return null
    const count = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : WORKER_LOG_LIMIT
    return service.readReadable(chatId, null, {
      cursor: 0, limit: count, order: 'newest', maxChars: PEER_READ_MAX_CHARS
    })
  })
}
