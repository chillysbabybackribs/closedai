import { shell, type IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { registerInvoke } from '../ipc-register.js'
import { openLocalFile } from './open.js'
import { realpath } from 'node:fs/promises'
import { localFilePath } from '../../shared/local-files.js'
import type { BrowserService } from '../browser-service.js'
import { validateImageSource } from './image-tab.js'

export function registerLocalFilesIpc(ipcMain: Pick<IpcMain, 'handle'>, getBrowser: () => BrowserService | null): void {
  const browser = (): BrowserService => {
    const service = getBrowser()
    if (!service) throw new Error('The browser pane is not available.')
    return service
  }
  registerInvoke(ipcMain, IPC.invoke.localFiles.open, async (_event, href) => {
    const result = await openLocalFile(href, (path) => shell.showItemInFolder(path))
    if (result.kind !== 'image') return result
    const path = await realpath(localFilePath(href)!)
    return { kind: 'image', tabId: browser().openImage({ ...result, path }) }
  })
  registerInvoke(ipcMain, IPC.invoke.localFiles.openImage, (_event, image) =>
    browser().openImage(validateImageSource(image)))
  registerInvoke(ipcMain, IPC.invoke.localFiles.image, (_event, id) => browser().imageContent(id))
  registerInvoke(ipcMain, IPC.invoke.localFiles.revealImage, (_event, id) => {
    const { path } = browser().imageContent(id)
    if (!path) throw new Error('This image has no local file to reveal.')
    shell.showItemInFolder(path)
  })
}
