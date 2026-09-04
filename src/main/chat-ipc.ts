import { dialog, shell, type IpcMain } from 'electron'
import { resolve } from 'node:path'
import type { ChatAttachment } from '../shared/chat.js'
import { CHAT_HISTORY_PAGE_SIZE } from '../shared/chat.js'
import type { ChatContinuationSource } from '../shared/chat-peers.js'
import type { ChatWorkspaceSurface } from './chat-peers/peer-manager.js'

export function registerChatIpc(ipcMain: IpcMain, getService: () => ChatWorkspaceSurface | null): void {
  const requireService = (): ChatWorkspaceSurface => {
    const service = getService()
    if (!service) throw new Error('Chat service is not available')
    return service
  }

  ipcMain.handle('chat:snapshot', () => requireService().snapshot({ limit: CHAT_HISTORY_PAGE_SIZE }))
  ipcMain.handle('chat:historyPage', (_event, paneId: string, threadId: string | null, beforeItemId: string) =>
    requireService().readHistoryPage(paneId, threadId, beforeItemId)
  )
  ipcMain.handle('chat:send', (_event, paneId: string, text: string, attachments: ChatAttachment[]) =>
    requireService().send(paneId, text, attachments)
  )
  ipcMain.handle('chat:interrupt', (_event, paneId: string) => requireService().interrupt(paneId))
  ipcMain.handle('chat:selectPane', (_event, paneId: string) => requireService().selectPane(paneId))
  ipcMain.handle('chat:selectModel', (_event, paneId: string, modelId: string) => requireService().selectModel(paneId, modelId))
  ipcMain.handle('chat:selectReasoningEffort', (_event, paneId: string, effort: string) =>
    requireService().selectReasoningEffort(paneId, effort)
  )
  ipcMain.handle('chat:refreshPlanUsage', (_event, paneId: string) => requireService().refreshPlanUsage(paneId))
  ipcMain.handle('chat:listChats', () => requireService().listChats())
  ipcMain.handle('chat:newPeer', () => requireService().newPeer())
  ipcMain.handle('chat:closePeer', (_event, paneId: string) => requireService().closePeer(paneId))
  ipcMain.handle('chat:continueInNewPeer', (_event, source: ChatContinuationSource, modelId: string | null) =>
    requireService().continueInNewPeer(source, modelId)
  )
  ipcMain.handle('chat:openChat', (_event, chatId: string) => requireService().openChat(chatId))
  ipcMain.handle('chat:archiveChat', (_event, chatId: string) => requireService().archiveChat(chatId))
  ipcMain.handle('chat:compactConversation', (_event, paneId: string) => requireService().compactConversation(paneId))
  ipcMain.handle('chat:chooseProject', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!result.canceled && result.filePaths[0]) await requireService().selectProject(resolve(result.filePaths[0]))
  })
  ipcMain.handle('chat:selectProject', (_event, projectPath: string) => {
    if (!projectPath.trim()) throw new Error('Choose a project folder')
    return requireService().selectProject(resolve(projectPath))
  })
  ipcMain.handle('chat:clearProject', () => requireService().selectProject(null))
  ipcMain.handle('chat:login', async () => {
    const authUrl = await requireService().beginLogin()
    if (authUrl) await shell.openExternal(authUrl)
  })
}
