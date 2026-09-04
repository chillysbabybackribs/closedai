import { shell, type IpcMain } from 'electron'
import { IPC } from '../shared/ipc-channels.js'
import type { BrowserDownloadService } from './browser-download-service.js'

// Lifted out of main-ipc.ts on the registerArtifactIpc precedent so that file stays a
// composition list — it sits near the 450-line hygiene cap.
//
// Note what is deliberately absent: there is no "open file" channel. Revealing a download in
// the file manager is inert, but handing a freshly downloaded path to shell.openPath would let
// a remote server pick what this machine executes. The service resolves ids to paths itself
// (pathFor), so the renderer never names a path and cannot reveal anything it did not download.

export function registerBrowserDownloadsIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  getDownloads: () => BrowserDownloadService | null
): void {
  ipcMain.handle(IPC.invoke.browserDownloads.list, () => getDownloads()?.list() ?? [])
  ipcMain.handle(IPC.invoke.browserDownloads.pause, (_event, id: string) => getDownloads()?.pause(id))
  ipcMain.handle(IPC.invoke.browserDownloads.resume, (_event, id: string) => getDownloads()?.resume(id))
  ipcMain.handle(IPC.invoke.browserDownloads.cancel, (_event, id: string) => getDownloads()?.cancel(id))
  ipcMain.handle(IPC.invoke.browserDownloads.clear, () => getDownloads()?.clear())
  ipcMain.handle(IPC.invoke.browserDownloads.reveal, (_event, id: string) => {
    // pathFor returns null unless this id completed, so a cancelled or in-flight row cannot
    // open a file manager onto a partial file.
    const path = getDownloads()?.pathFor(id)
    if (path) shell.showItemInFolder(path)
  })
}
