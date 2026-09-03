import { shell, type IpcMain } from 'electron'
import type { ChatAttachment } from '../shared/chat.js'
import type { ChatContinuationSource } from '../shared/chat-peers.js'
import type { ChatWorkspaceSurface } from './chat-peers/peer-manager.js'

export function registerChatIpc(ipcMain: IpcMain, getService: () => ChatWorkspaceSurface | null): void {
  const requireService = (): ChatWorkspaceSurface => {
    const service = getService()
    if (!service) throw new Error('Chat service is not available')
    return service
  }

  ipcMain.handle('chat:snapshot', () => requireService().snapshot())
  ipcMain.handle('chat:send', (_event, paneId: string, text: string, attachments: ChatAttachment[]) =>
    requireService().send(paneId, text, attachments)
  )
  ipcMain.handle('chat:interrupt', (_event, paneId: string) => requireService().interrupt(paneId))
  ipcMain.handle('chat:selectPane', (_event, paneId: string) => requireService().selectPane(paneId))
  ipcMain.handle('chat:selectModel', (_event, paneId: string, modelId: string) => requireService().selectModel(paneId, modelId))
  ipcMain.handle('chat:selectReasoningEffort', (_event, paneId: string, effort: string) =>
    requireService().selectReasoningEffort(paneId, effort)
  )
  ipcMain.handle('chat:listThreads', () => requireService().listThreads())
  ipcMain.handle('chat:newPeer', () => requireService().newPeer())
  ipcMain.handle('chat:closePeer', (_event, paneId: string) => requireService().closePeer(paneId))
  ipcMain.handle('chat:continueInNewPeer', (_event, source: ChatContinuationSource, modelId: string | null) =>
    requireService().continueInNewPeer(source, modelId)
  )
  ipcMain.handle('chat:openThread', (_event, paneId: string, threadId: string) => requireService().openThread(paneId, threadId))
  ipcMain.handle('chat:archiveThread', (_event, threadId: string) => requireService().archiveThread(threadId))
  ipcMain.handle('chat:login', async () => {
    const authUrl = await requireService().beginLogin()
    if (authUrl) await shell.openExternal(authUrl)
  })
}
