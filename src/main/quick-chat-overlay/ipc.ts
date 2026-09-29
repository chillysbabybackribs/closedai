import type { IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { QUICK_CHAT_OVERLAY_REQUESTS } from '../../shared/quick-chat-overlay.js'
import { registerInvoke } from '../ipc-register.js'
import type { AppWindowRegistry } from '../windows/app-window-registry.js'
import { overlaySize } from './overlay-placement.js'
import type { QuickChatOverlay } from './quick-chat-overlay.js'

/** The main window reports the quick chat's state; only the layer itself reads its view and asks for changes. */
export function registerQuickChatIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  overlay: () => QuickChatOverlay | null,
  windows: () => AppWindowRegistry | null
): void {
  registerInvoke(ipcMain, IPC.invoke.quickChat.setState, (event, state) => {
    if (windows()?.isMain(event.sender) ?? true) overlay()?.setState(state)
  })
  registerInvoke(ipcMain, IPC.invoke.quickChat.view, (event) => {
    const layer = overlay()
    return layer?.owns(event.sender) ? layer.current() : null
  })
  registerInvoke(ipcMain, IPC.invoke.quickChat.setSize, (event, raw) => {
    const size = overlaySize(raw)
    if (size) overlay()?.setSize(event.sender, size)
  })
  registerInvoke(ipcMain, IPC.invoke.quickChat.request, (event, request) => {
    if (!overlay()?.owns(event.sender) || !QUICK_CHAT_OVERLAY_REQUESTS.includes(request)) return
    windows()?.quickChat(request)
  })
}
