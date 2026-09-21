import type { IpcMain } from 'electron'
import { IPC, type IpcEventChannel, type IpcEventChannels } from '../shared/ipc-channels.js'
import type { BrowserCookieImportResult, SecurityDecision } from '../shared/security.js'
import { registerInvoke } from './ipc-register.js'
import type { BrowserPermissionBroker } from './browser-permission-broker.js'
import type { CredentialApprovalBroker } from './security-approvals.js'
import type { CredentialVault } from './credential-vault.js'
import type { SecuritySettingsAccess } from './security-settings-store.js'

export type SecurityIpcDeps = {
  settings: () => SecuritySettingsAccess | null
  vault: () => Pick<CredentialVault, 'setAgentAccess'> | null
  importCookies: () => Promise<BrowserCookieImportResult>
  credentialApprovals: CredentialApprovalBroker
  permissions: BrowserPermissionBroker
  /** Liveness-guarded push to the renderer. */
  send: <C extends IpcEventChannel>(channel: C, payload: IpcEventChannels[C]) => void
}

/** Settings → Security invoke channels plus the two pending-list pushes. Returns the unsubscribe. */
export function registerSecurityIpc(ipcMain: Pick<IpcMain, 'handle'>, deps: SecurityIpcDeps): () => void {
  const settings = (): SecuritySettingsAccess => {
    const store = deps.settings()
    if (!store) throw new Error('Security settings are not ready')
    return store
  }
  registerInvoke(ipcMain, IPC.invoke.security.get, () => settings().get())
  registerInvoke(ipcMain, IPC.invoke.security.set, (_event, patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid security settings patch')
    return settings().set(patch)
  })
  registerInvoke(ipcMain, IPC.invoke.security.importCookies, () => deps.importCookies())
  registerInvoke(ipcMain, IPC.invoke.security.resolveCredentialApproval, (_event, id, decision) => {
    deps.credentialApprovals.resolve(requireId(id), requireDecision(decision))
  })
  registerInvoke(ipcMain, IPC.invoke.browser.resolvePermission, (_event, id, decision) => {
    deps.permissions.resolve(requireId(id), requireDecision(decision))
  })
  registerInvoke(ipcMain, IPC.invoke.credentials.setAgentAccess, (_event, id, allowed) => {
    const vault = deps.vault()
    if (!vault) throw new Error('Credential vault is not ready')
    if (typeof allowed !== 'boolean') throw new Error('Invalid agent access value')
    return vault.setAgentAccess(requireId(id), allowed)
  })
  const stops = [
    deps.credentialApprovals.onChange((pending) => deps.send(IPC.event.securityCredentialApprovals, pending)),
    deps.permissions.onChange((pending) => deps.send(IPC.event.browserPermissionRequests, pending))
  ]
  return () => { for (const stop of stops) stop() }
}

function requireId(id: unknown): string {
  if (typeof id !== 'string' || id.length === 0) throw new Error('Invalid request id')
  return id
}

function requireDecision(decision: unknown): SecurityDecision {
  if (decision !== 'allow' && decision !== 'deny') throw new Error('Invalid decision')
  return decision
}
