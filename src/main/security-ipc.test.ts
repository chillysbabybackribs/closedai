import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import { DEFAULT_SECURITY_SETTINGS, type SecuritySettings } from '../shared/security.ts'
import { BrowserPermissionBroker } from './browser-permission-broker.ts'
import { CredentialApprovalBroker } from './security-approvals.ts'
import { registerSecurityIpc } from './security-ipc.ts'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function harness() {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } as unknown as Pick<IpcMain, 'handle'>
  let settings: SecuritySettings = { ...DEFAULT_SECURITY_SETTINGS }
  const sent: [string, unknown][] = []
  const access: [string, boolean][] = []
  const credentialApprovals = new CredentialApprovalBroker(10_000)
  const permissions = new BrowserPermissionBroker(10_000)
  const stop = registerSecurityIpc(ipcMain, {
    settings: () => ({
      get: () => ({ ...settings }),
      set: async (patch) => { settings = { ...settings, ...patch }; return { ...settings } },
      onChange: () => () => {}
    }),
    vault: () => ({ setAgentAccess: async (id: string, allowed: boolean) => { access.push([id, allowed]); return { id, agentAccess: allowed } as never } }),
    importCookies: async () => ({ source: 'Google Chrome', imported: 2, failed: 0, skipped: 1 }),
    credentialApprovals,
    permissions,
    send: (channel, payload) => { sent.push([channel, payload]) }
  })
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel)
    assert.ok(handler, `missing handler for ${channel}`)
    return handler({} as IpcMainInvokeEvent, ...args)
  }
  return { invoke, sent, access, credentialApprovals, permissions, stop }
}

test('get and set round-trip the settings; a non-object patch is refused', async () => {
  const { invoke } = harness()
  assert.deepEqual(await invoke('security:get'), DEFAULT_SECURITY_SETTINGS)
  const next = await invoke('security:set', { webPermissions: 'ask' }) as SecuritySettings
  assert.equal(next.webPermissions, 'ask')
  await assert.rejects(invoke('security:set', 'ask'), /Invalid security settings patch/)
})

test('cookie import and agent access delegate with validated arguments', async () => {
  const { invoke, access } = harness()
  assert.deepEqual(await invoke('security:importCookies'), { source: 'Google Chrome', imported: 2, failed: 0, skipped: 1 })
  await invoke('credentials:setAgentAccess', 'cred-1', false)
  assert.deepEqual(access, [['cred-1', false]])
  await assert.rejects(invoke('credentials:setAgentAccess', 'cred-1', 'no'), /Invalid agent access value/)
  await assert.rejects(invoke('credentials:setAgentAccess', '', true), /Invalid request id/)
})

test('pending lists are pushed on change and decisions resolve the waiting caller', async () => {
  const { invoke, sent, credentialApprovals, permissions, stop } = harness()
  const approval = credentialApprovals.ask({ paneId: 'pane-1', credentialId: 'c', credentialLabel: 'C', serviceName: 'S', fieldIds: ['k'], reason: 'r' })
  const permission = permissions.ask({ tabId: 't', origin: 'https://a.example', permission: 'geolocation' })
  assert.deepEqual(sent.map(([channel, payload]) => [channel, (payload as unknown[]).length]), [['security:credentialApprovals', 1], ['browser:permissionRequests', 1]])
  await invoke('security:resolveCredentialApproval', credentialApprovals.pending()[0]!.id, 'allow')
  await invoke('browser:resolvePermission', permissions.pending()[0]!.id, 'deny')
  assert.deepEqual([await approval, await permission], [true, false])
  assert.deepEqual(sent.slice(2).map(([channel, payload]) => [channel, (payload as unknown[]).length]), [['security:credentialApprovals', 0], ['browser:permissionRequests', 0]])
  await assert.rejects(invoke('browser:resolvePermission', 'x', 'maybe'), /Invalid decision/)
  stop()
  void permissions.ask({ tabId: 't', origin: 'https://a.example', permission: 'media' })
  assert.equal(sent.length, 4, 'after unsubscribe nothing is pushed')
})
