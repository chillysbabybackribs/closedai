import { shell, type IpcMain } from 'electron'
import type { ChatApprovalDecision, ChatAttachment } from '../shared/chat.js'
import type { ChatService } from './chat-service.js'

export function registerChatIpc(ipcMain: IpcMain, getService: () => ChatService | null): void {
  const requireService = (): ChatService => {
    const service = getService()
    if (!service) throw new Error('Chat service is not available')
    return service
  }

  ipcMain.handle('chat:snapshot', () => requireService().snapshot())
  ipcMain.handle('chat:send', (_event, text: string, attachments: ChatAttachment[]) =>
    requireService().send(text, attachments)
  )
  ipcMain.handle('chat:interrupt', () => requireService().interrupt())
  ipcMain.handle('chat:selectModel', (_event, modelId: string) => requireService().selectModel(modelId))
  ipcMain.handle('chat:approval', (_event, requestId: string, decision: ChatApprovalDecision) =>
    requireService().respondToApproval(requestId, decision)
  )
  ipcMain.handle('chat:listThreads', () => requireService().listThreads())
  ipcMain.handle('chat:newThread', () => requireService().newThread())
  ipcMain.handle('chat:openThread', (_event, threadId: string) => requireService().openThread(threadId))
  ipcMain.handle('chat:archiveThread', (_event, threadId: string) => requireService().archiveThread(threadId))
  ipcMain.handle('chat:login', async () => {
    const authUrl = await requireService().beginChatGptLogin()
    await shell.openExternal(authUrl)
  })
}
