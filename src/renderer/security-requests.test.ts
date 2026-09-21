import assert from 'node:assert/strict'
import test from 'node:test'

import type { CredentialApprovalRequest, SecurityDecision, WebPermissionRequest } from '../shared/security.ts'
import {
  createSecurityRequestsController, credentialRequestsForPane, permissionRequestsForTab, securityRequestsApi,
  type SecurityRequestsApi
} from './security-requests.ts'

function credential(id: string, paneId: string | null = 'pane-1'): CredentialApprovalRequest {
  return { id, paneId, credentialId: 'cred-1', credentialLabel: 'GitHub', serviceName: 'github.com',
    fieldIds: ['token'], reason: 'push the branch', requestedAt: 1 }
}

function permission(id: string, tabId: string): WebPermissionRequest {
  return { id, tabId, origin: 'https://meet.example', permission: 'media', requestedAt: 1 }
}

/** A bridge double that records resolves and lets the test push pending lists. */
function fakeApi(options: { rejectResolve?: boolean } = {}) {
  const credentialListeners = new Set<(pending: CredentialApprovalRequest[]) => void>()
  const permissionListeners = new Set<(pending: WebPermissionRequest[]) => void>()
  const resolved: Array<[string, string, SecurityDecision]> = []
  let subscriptions = 0
  const resolve = (kind: string) => async (id: string, decision: SecurityDecision) => {
    resolved.push([kind, id, decision])
    if (options.rejectResolve) throw new Error("Error invoking remote method 'security:resolve': request expired")
  }
  const api: SecurityRequestsApi = {
    onCredentialApprovals: (listener) => { subscriptions++; credentialListeners.add(listener); return () => { subscriptions--; credentialListeners.delete(listener) } },
    resolveCredentialApproval: resolve('credential'),
    onPermissionRequests: (listener) => { subscriptions++; permissionListeners.add(listener); return () => { subscriptions--; permissionListeners.delete(listener) } },
    resolvePermission: resolve('permission')
  }
  return {
    api, resolved,
    get subscriptions() { return subscriptions },
    pushCredentials: (pending: CredentialApprovalRequest[]) => credentialListeners.forEach((listener) => listener(pending)),
    pushPermissions: (pending: WebPermissionRequest[]) => permissionListeners.forEach((listener) => listener(pending))
  }
}

test('the adapter names the bridge methods once and is null until the preload exposes them', () => {
  assert.equal(securityRequestsApi({}), null)
  assert.equal(securityRequestsApi({ security: { onCredentialApprovals: () => () => {} } }), null)
  const fake = fakeApi()
  const api = securityRequestsApi({
    security: { onCredentialApprovals: fake.api.onCredentialApprovals, resolveCredentialApproval: fake.api.resolveCredentialApproval },
    browser: { onPermissionRequests: fake.api.onPermissionRequests, resolvePermission: fake.api.resolvePermission }
  })
  assert.ok(api)
  assert.equal(api.onCredentialApprovals, fake.api.onCredentialApprovals)
  assert.equal(api.resolvePermission, fake.api.resolvePermission)
})

test('without the API the feeds stay silent and a decision fails with a readable reason', async () => {
  const controller = createSecurityRequestsController(null)
  let calls = 0
  const release = controller.credentials.subscribe(() => { calls++ })
  release()
  assert.equal(calls, 0)
  await assert.rejects(controller.permissions.resolve('p1', 'allow'), /not available/)
})

test('one main subscription serves many panes and is released with the last of them', () => {
  const fake = fakeApi()
  const controller = createSecurityRequestsController(fake.api)
  const seenA: CredentialApprovalRequest[][] = []
  const seenB: CredentialApprovalRequest[][] = []
  const releaseA = controller.credentials.subscribe((pending) => seenA.push(pending))
  fake.pushCredentials([credential('c1')])
  const releaseB = controller.credentials.subscribe((pending) => seenB.push(pending))
  assert.equal(fake.subscriptions, 1)
  assert.deepEqual(seenA.map((list) => list.map((request) => request.id)), [['c1']])
  // A late subscriber gets the known list at once rather than waiting for the next change.
  assert.deepEqual(seenB.map((list) => list.map((request) => request.id)), [['c1']])
  releaseA()
  assert.equal(fake.subscriptions, 1)
  releaseB()
  assert.equal(fake.subscriptions, 0)
})

test('a decision hides the request at once, resolves through the bridge, and stays hidden until main drops it', async () => {
  const fake = fakeApi()
  const controller = createSecurityRequestsController(fake.api)
  const seen: string[][] = []
  controller.permissions.subscribe((pending) => seen.push(pending.map((request) => request.id)))
  fake.pushPermissions([permission('p1', 'tab-1'), permission('p2', 'tab-1')])
  const done = controller.permissions.resolve('p1', 'deny')
  assert.deepEqual(seen.at(-1), ['p2'])
  await done
  assert.deepEqual(fake.resolved, [['permission', 'p1', 'deny']])
  // Main has not dropped it yet: the same list re-published still hides p1.
  fake.pushPermissions([permission('p1', 'tab-1'), permission('p2', 'tab-1')])
  assert.deepEqual(seen.at(-1), ['p2'])
  // Main dropped it, then (a new request reusing nothing) the id is no longer pinned hidden.
  fake.pushPermissions([permission('p2', 'tab-1')])
  fake.pushPermissions([permission('p1', 'tab-1'), permission('p2', 'tab-1')])
  assert.deepEqual(seen.at(-1), ['p1', 'p2'])
})

test('a rejected decision restores the request and rethrows for the caller’s notice', async () => {
  const fake = fakeApi({ rejectResolve: true })
  const controller = createSecurityRequestsController(fake.api)
  const seen: string[][] = []
  controller.credentials.subscribe((pending) => seen.push(pending.map((request) => request.id)))
  fake.pushCredentials([credential('c1')])
  await assert.rejects(controller.credentials.resolve('c1', 'allow'), /request expired/)
  assert.deepEqual(seen, [['c1'], [], ['c1']])
})

test('a pane shows its own requests; the selected pane also shows orphaned ones', () => {
  const pending = [credential('own', 'pane-1'), credential('other', 'pane-2'), credential('none', null), credential('gone', 'pane-closed')]
  const open = ['pane-1', 'pane-2']
  const ids = (list: CredentialApprovalRequest[]) => list.map((request) => request.id)
  assert.deepEqual(ids(credentialRequestsForPane(pending, 'pane-1', true, open)), ['own', 'none', 'gone'])
  assert.deepEqual(ids(credentialRequestsForPane(pending, 'pane-1', false, open)), ['own'])
  assert.deepEqual(ids(credentialRequestsForPane(pending, 'pane-2', false, open)), ['other'])
  assert.deepEqual(ids(credentialRequestsForPane(pending, 'pane-2', true, open)), ['other', 'none', 'gone'])
})

test('only the active tab’s permission requests show', () => {
  const pending = [permission('p1', 'tab-1'), permission('p2', 'tab-2')]
  assert.deepEqual(permissionRequestsForTab(pending, 'tab-2').map((request) => request.id), ['p2'])
  assert.deepEqual(permissionRequestsForTab(pending, null), [])
})
