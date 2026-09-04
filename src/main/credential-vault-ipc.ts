import type { IpcMain } from 'electron'
import { IPC } from '../shared/ipc-channels.js'
import { registerInvoke } from './ipc-register.js'
import type { CredentialVault } from './credential-vault.js'

export function registerCredentialVaultIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  getVault: () => CredentialVault | null
): void {
  const vault = (): CredentialVault => {
    const instance = getVault()
    if (!instance) throw new Error('Credential vault is not ready')
    return instance
  }

  registerInvoke(ipcMain, IPC.invoke.credentials.status, () => vault().status())
  registerInvoke(ipcMain, IPC.invoke.credentials.list, () => vault().list())
  registerInvoke(ipcMain, IPC.invoke.credentials.save, (_event, draft) => vault().save(draft))
  registerInvoke(ipcMain, IPC.invoke.credentials.reveal, (_event, id, fieldId) => vault().reveal(id, fieldId))
  registerInvoke(ipcMain, IPC.invoke.credentials.remove, (_event, id) => vault().remove(id))
  registerInvoke(ipcMain, IPC.invoke.credentials.rename, (_event, id, label) => vault().rename(id, label))
}
