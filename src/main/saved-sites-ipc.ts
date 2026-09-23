import type { IpcMain } from 'electron'
import { IPC } from '../shared/ipc-channels.js'
import type { SavedSiteDraft, SavedSitePatch } from '../shared/saved-sites.js'
import type { SavedSitesStore } from './saved-sites-store.js'

// Same shape as the downloads channels: the renderer names ids, the store owns the file.

export function registerSavedSitesIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  getSavedSites: () => SavedSitesStore | null
): void {
  ipcMain.handle(IPC.invoke.savedSites.list, () => getSavedSites()?.list() ?? [])
  ipcMain.handle(IPC.invoke.savedSites.save, (_event, draft: SavedSiteDraft) => {
    const store = getSavedSites()
    if (!store) throw new Error('Saved sites are not available yet')
    return store.save(draft)
  })
  ipcMain.handle(IPC.invoke.savedSites.update, (_event, id: string, patch: SavedSitePatch) => getSavedSites()?.update(id, patch) ?? null)
  ipcMain.handle(IPC.invoke.savedSites.remove, (_event, id: string) => getSavedSites()?.remove(id))
}
