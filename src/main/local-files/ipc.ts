import { listDirectory } from '../file-tree/list.js'
import { app, dialog, shell, type IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { registerInvoke } from '../ipc-register.js'
import { openLocalFile } from './open.js'
import { readFilePreview } from './read-file-preview.js'
import { realpath } from 'node:fs/promises'
import { basename } from 'node:path'
import { isBrowserDocumentFile, type LocalFileOpenOptions } from '../../shared/local-files.js'
import type { BrowserService } from '../browser-service.js'
import { validateImageSource } from './image-tab.js'

export function registerLocalFilesIpc(ipcMain: Pick<IpcMain, 'handle'>, getBrowser: () => BrowserService | null): void {
  registerInvoke(ipcMain, IPC.invoke.localFiles.listDirectory, (_event, root, directory) => listDirectory(root, directory))
  const browser = (): BrowserService => {
    const service = getBrowser()
    if (!service) throw new Error('The browser pane is not available.')
    return service
  }
  registerInvoke(ipcMain, IPC.invoke.localFiles.preview, (_event, href, options?: LocalFileOpenOptions) =>
    openLocalFile(href, (path) => shell.showItemInFolder(path), options))
  registerInvoke(ipcMain, IPC.invoke.localFiles.readPreview, async (_event, path: string) => {
    const resolved = await realpath(path)
    return readFilePreview({ path: resolved, name: basename(resolved) })
  })
  registerInvoke(ipcMain, IPC.invoke.localFiles.revealPath, async (_event, path: string) => {
    shell.showItemInFolder(await realpath(path))
  })
  registerInvoke(ipcMain, IPC.invoke.localFiles.open, async (_event, href, options?: LocalFileOpenOptions) => {
    const result = await openLocalFile(href, (path) => shell.showItemInFolder(path), options)
    if (result.kind === 'image') {
      const path = await realpath(result.path)
      return { kind: 'image', tabId: browser().openImage({ name: result.name, src: result.src, path }) }
    }
    if (result.kind === 'video') {
      const path = await realpath(result.path)
      return {
        kind: 'video',
        tabId: browser().openVideo({ name: result.name, src: result.src, path, revision: 0 })
      }
    }
    if (result.kind === 'file') {
      const path = await realpath(result.path)
      // Markup opens as the page it builds; a line or diff target asks for the source.
      if (!result.line && !result.diff && isBrowserDocumentFile(path)) return { kind: 'file', tabId: browser().openFilePage(path) }
      const tabId = browser().openFileTab({
        path,
        name: basename(path),
        line: result.line,
        endLine: result.endLine,
        cwd: result.cwd,
        diff: result.diff
      })
      return { kind: 'file', tabId }
    }
    return result
  })
  registerInvoke(ipcMain, IPC.invoke.localFiles.openImage, (_event, image) =>
    browser().openImage(validateImageSource(image)))
  registerInvoke(ipcMain, IPC.invoke.localFiles.image, (_event, id) => browser().imageContent(id))
  registerInvoke(ipcMain, IPC.invoke.localFiles.revealImage, (_event, id) => {
    const { path } = browser().imageContent(id)
    if (!path) throw new Error('This image has no local file to reveal.')
    shell.showItemInFolder(path)
  })
  registerInvoke(ipcMain, IPC.invoke.localFiles.video, (_event, id) => browser().videoContent(id))
  registerInvoke(ipcMain, IPC.invoke.localFiles.revealVideo, async (_event, id) => {
    const { path } = await browser().videoContent(id)
    shell.showItemInFolder(path)
  })
  registerInvoke(ipcMain, IPC.invoke.localFiles.file, (_event, id) => browser().fileContent(id))
  registerInvoke(ipcMain, IPC.invoke.localFiles.revealFile, async (_event, id) => {
    const { path } = await browser().fileContent(id)
    shell.showItemInFolder(path)
  })
  registerInvoke(ipcMain, IPC.invoke.localFiles.setView, (_event, id, view) => {
    if (view !== 'page' && view !== 'code') throw new Error('view must be page or code')
    browser().setFileView(id, view)
  })
  registerInvoke(ipcMain, IPC.invoke.localFiles.searchVideos, (_event, query: string) => browser().searchVideos(query))
  registerInvoke(ipcMain, IPC.invoke.localFiles.videoRecents, () => browser().videoRecentList())
  registerInvoke(ipcMain, IPC.invoke.localFiles.pickVideo, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open video',
      defaultPath: app.getPath('downloads'),
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'webm'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })
}
