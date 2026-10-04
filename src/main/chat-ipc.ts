import { dialog, shell, type IpcMain, type WebContents } from 'electron'
import { MAIN_WINDOW_ID } from '../shared/app-windows.js'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ChatAttachment, ChatProvider } from '../shared/chat.js'
import { readProviderUsage } from './chat-context/provider-usage.js'
import { CHAT_PROVIDERS } from '../shared/chat-providers.js'
import { CHAT_TURN_PAGE_SIZE } from '../shared/chat.js'
import type { ChatContinuationSource, ChatNewPeerOptions } from '../shared/chat-peers.js'
import { IPC } from '../shared/ipc-channels.js'
import type { ChatWorkspaceSurface } from './chat-peers/peer-manager.js'
import { detectProviderAvailability } from './provider-availability.js'

/** Which window a request came from, and where that window's tiles are recorded for event routing. */
export type ChatIpcWindows = {
  idOf: (sender: WebContents) => string | null
  claim: (windowId: string, visible: string[], tabs: string[]) => void
}

export function registerChatIpc(ipcMain: IpcMain, getService: () => ChatWorkspaceSurface | null, windows: () => ChatIpcWindows | null = () => null): void {
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
  ipcMain.handle(IPC.invoke.chat.setVisiblePanes, async (event, cwd: string, paneIds: string[], retainedTabIds?: string[]) => {
    const registry = windows()
    const windowId = registry?.idOf(event.sender) ?? MAIN_WINDOW_ID
    // Routed first, so the stream that showing a chat wakes reaches the window that shows it.
    registry?.claim(windowId, paneIds, retainedTabIds ?? [])
    await requireService().setVisiblePanes(cwd, paneIds, retainedTabIds, windowId)
  })
  ipcMain.handle(IPC.invoke.chat.selectModel, (_event, paneId: string, modelId: string) => requireService().selectModel(paneId, modelId))
  ipcMain.handle(IPC.invoke.chat.selectReasoningEffort, (_event, paneId: string, effort: string) =>
    requireService().selectReasoningEffort(paneId, effort)
  )
  ipcMain.handle(IPC.invoke.chat.readProviderUsage, (_event, provider: ChatProvider, force?: boolean) => {
    if (!CHAT_PROVIDERS.includes(provider)) throw new Error('Choose a valid provider')
    return readProviderUsage(provider, force === true)
  })
  ipcMain.handle(IPC.invoke.chat.refreshPlanUsage, (_event, paneId: string, onlyIfAwake?: boolean) => requireService().refreshPlanUsage(paneId, onlyIfAwake))
  ipcMain.handle(IPC.invoke.chat.listChats, () => requireService().listChats())
  ipcMain.handle(IPC.invoke.chat.newPeer, (_event, anchorPaneId?: string, options?: ChatNewPeerOptions) => {
    if (options !== undefined && (typeof options !== 'object' || options === null
      || (options.select !== undefined && typeof options.select !== 'boolean')
      || (options.modelId !== undefined && (typeof options.modelId !== 'string' || !options.modelId))
      || (options.quickChatSurface !== undefined && options.quickChatSurface !== 'browser' && options.quickChatSurface !== 'notepad'))) {
      throw new Error('Choose valid new chat options')
    }
    return requireService().newPeer(anchorPaneId, options)
  })
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
  // A space is a project the workspace can show; switching keeps every chat's own folder and runtime.
  ipcMain.handle(IPC.invoke.chat.selectSpace, async (_event, projectPath: string | null) => {
    if (projectPath === null) return requireService().selectProject(null)
    const path = resolve(projectPath)
    if (!(await stat(path).then((entry) => entry.isDirectory(), () => false))) throw new Error(`${path} is no longer a folder`)
    return requireService().selectProject(path)
  })
  // Needs no service: a first-run screen asks this before any chat has started a provider.
  ipcMain.handle(IPC.invoke.chat.providerAvailability, () => detectProviderAvailability())
  ipcMain.handle(IPC.invoke.chat.providerOnboarding, () => requireService().probeProviderOnboarding())
  ipcMain.handle(IPC.invoke.chat.login, async () => {
    const authUrl = await requireService().beginLogin()
    if (authUrl) await shell.openExternal(authUrl)
  })
  ipcMain.handle(IPC.invoke.chat.providerSignIn, async (_event, provider: unknown) => {
    if (typeof provider !== 'string' || !(CHAT_PROVIDERS as readonly string[]).includes(provider)) {
      throw new Error('Choose a valid provider to sign in')
    }
    const authUrl = await requireService().beginProviderLogin(provider as ChatProvider)
    if (authUrl) await shell.openExternal(authUrl)
  })
}
