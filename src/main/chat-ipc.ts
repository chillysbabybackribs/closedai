import { dialog, shell, type IpcMain } from 'electron'
import { resolve } from 'node:path'
import type { ChatAttachment } from '../shared/chat.js'
import { CHAT_TURN_PAGE_SIZE } from '../shared/chat.js'
import type { ChatContinuationSource } from '../shared/chat-peers.js'
import { IPC } from '../shared/ipc-channels.js'
import type { ChatWorkspaceSurface } from './chat-peers/peer-manager.js'
import { detectProviderAvailability } from './provider-availability.js'

export function registerChatIpc(ipcMain: IpcMain, getService: () => ChatWorkspaceSurface | null): void {
  const requireService = (): ChatWorkspaceSurface => {
    const service = getService()
    if (!service) throw new Error('Chat service is not available')
    return service
  }

  ipcMain.handle(IPC.invoke.chat.snapshot, () => requireService().snapshot({ limit: CHAT_TURN_PAGE_SIZE, unit: 'turn' }))
  ipcMain.handle(IPC.invoke.chat.historyPage, (_event, paneId: string, threadId: string | null, beforeItemId: string) =>
    requireService().readHistoryPage(paneId, threadId, beforeItemId)
  )
  ipcMain.handle(IPC.invoke.chat.send, (_event, paneId: string, text: string, attachments: ChatAttachment[]) =>
    requireService().send(paneId, text, attachments)
  )
  ipcMain.handle(IPC.invoke.chat.interrupt, (_event, paneId: string) => requireService().interrupt(paneId))
  ipcMain.handle(IPC.invoke.chat.selectPane, (_event, paneId: string) => requireService().selectPane(paneId))
  ipcMain.handle(IPC.invoke.chat.setVisiblePanes, (_event, cwd: string, paneIds: string[], retainedTabIds?: string[]) =>
    requireService().setVisiblePanes(cwd, paneIds, retainedTabIds))
  ipcMain.handle(IPC.invoke.chat.selectModel, (_event, paneId: string, modelId: string) => requireService().selectModel(paneId, modelId))
  ipcMain.handle(IPC.invoke.chat.selectReasoningEffort, (_event, paneId: string, effort: string) =>
    requireService().selectReasoningEffort(paneId, effort)
  )
  ipcMain.handle(IPC.invoke.chat.refreshPlanUsage, (_event, paneId: string) => requireService().refreshPlanUsage(paneId))
  ipcMain.handle(IPC.invoke.chat.listChats, () => requireService().listChats())
  ipcMain.handle(IPC.invoke.chat.newPeer, () => requireService().newPeer())
  ipcMain.handle(IPC.invoke.chat.newDetachedPeer, () => requireService().newDetachedPeer())
  ipcMain.handle(IPC.invoke.chat.closePeer, (_event, paneId: string) => requireService().closePeer(paneId))
  ipcMain.handle(IPC.invoke.chat.continueInNewPeer, (_event, source: ChatContinuationSource, modelId: string | null) =>
    requireService().continueInNewPeer(source, modelId)
  )
  ipcMain.handle(IPC.invoke.chat.openChat, (_event, chatId: string) => requireService().openChat(chatId))
  ipcMain.handle(IPC.invoke.chat.archiveChat, (_event, chatId: string) => requireService().archiveChat(chatId))
  ipcMain.handle(IPC.invoke.chat.unarchiveChat, (_event, chatId: string) => requireService().unarchiveChat(chatId))
  ipcMain.handle(IPC.invoke.chat.setChatPinned, (_event, chatId: string, pinned: boolean) => requireService().setChatPinned(chatId, pinned))
  ipcMain.handle(IPC.invoke.chat.renameChat, (_event, chatId: string, title: string | null) =>
    requireService().renameChat(chatId, title)
  )
  ipcMain.handle(IPC.invoke.chat.retryChatTitle, (_event, chatId: string) =>
    requireService().retryChatTitle(chatId)
  )
  ipcMain.handle(IPC.invoke.chat.compactConversation, (_event, paneId: string) => requireService().compactConversation(paneId))
  ipcMain.handle(IPC.invoke.chat.chooseProject, async (_event, paneId: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!result.canceled && result.filePaths[0]) await requireService().selectChatProject(paneId, resolve(result.filePaths[0]))
  })
  ipcMain.handle(IPC.invoke.chat.selectProject, (_event, paneId: string, projectPath: string) => {
    if (!projectPath.trim()) throw new Error('Choose a project folder')
    return requireService().selectChatProject(paneId, resolve(projectPath))
  })
  ipcMain.handle(IPC.invoke.chat.clearProject, (_event, paneId: string) => requireService().selectChatProject(paneId, null))
  // Needs no service: a first-run screen asks this before any chat has started a provider.
  ipcMain.handle(IPC.invoke.chat.providerAvailability, () => detectProviderAvailability())
  ipcMain.handle(IPC.invoke.chat.login, async () => {
    const authUrl = await requireService().beginLogin()
    if (authUrl) await shell.openExternal(authUrl)
  })
}
