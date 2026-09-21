import assert from 'node:assert/strict'
import test from 'node:test'
import type { DesktopCapturerSource, Session, WebContents } from 'electron'

import type { WebPermissionPolicy, WebPermissionRequest } from '../shared/security.ts'
import { installContentsPermissionPolicy, installPermissionPolicy, type PermissionPolicyDeps } from './browser-permissions.ts'

type AnyFn = (...args: never[]) => unknown
type Handlers = {
  request: (contents: WebContents, permission: string, callback: (granted: boolean) => void, details: unknown) => void
  check: (contents: WebContents | null, permission: string) => boolean
  device: () => boolean
  display: (request: { videoRequested: boolean }, callback: (streams: unknown) => void) => void
  events: Map<string, AnyFn>
}

const contents = { getURL: () => 'https://page.example/app' } as unknown as WebContents
const sources = [{ id: 'screen:1', name: 'Screen' }, { id: 'window:2', name: 'Window' }] as DesktopCapturerSource[]

function fakeSession(policy: WebPermissionPolicy, ask?: PermissionPolicyDeps['ask']): {
  handlers: Handlers; asked: Omit<WebPermissionRequest, 'id' | 'requestedAt'>[]
} {
  const handlers = { events: new Map<string, AnyFn>() } as Handlers
  const session = {
    setPermissionRequestHandler: (handler: Handlers['request']) => { handlers.request = handler },
    setPermissionCheckHandler: (handler: Handlers['check']) => { handlers.check = handler },
    setDevicePermissionHandler: (handler: Handlers['device']) => { handlers.device = handler },
    setDisplayMediaRequestHandler: (handler: Handlers['display']) => { handlers.display = handler },
    on: (name: string, handler: AnyFn) => { handlers.events.set(name, handler) }
  } as unknown as Session
  const asked: Omit<WebPermissionRequest, 'id' | 'requestedAt'>[] = []
  installPermissionPolicy(session, {
    policy: () => policy,
    ask: ask ?? (async (request) => { asked.push(request); return true }),
    tabIdFor: () => 'tab-7',
    captureSources: async () => sources
  })
  return { handlers, asked }
}

const preventable = (): { prevented: boolean; event: { preventDefault: () => void } } => {
  const guard = { prevented: false, event: { preventDefault: () => { guard.prevented = true } } }
  return guard
}

function request(handlers: Handlers, permission: string): Promise<boolean> {
  return new Promise((resolve) => handlers.request(contents, permission, resolve, { requestingUrl: 'https://page.example/app' }))
}

function pickers(handlers: Handlers): { hid: unknown; serial: unknown; usb: unknown; prevented: boolean[] } {
  const results: { hid?: unknown; serial?: unknown; usb?: unknown } = {}
  const guards = [preventable(), preventable(), preventable()]
  handlers.events.get('select-hid-device')!(...[guards[0]!.event, { deviceList: [{ deviceId: 'hid-a' }, { deviceId: 'hid-b' }] }, (id: unknown) => { results.hid = id }] as never[])
  handlers.events.get('select-serial-port')!(...[guards[1]!.event, [{ portId: 'port-a' }], contents, (id: unknown) => { results.serial = id }] as never[])
  handlers.events.get('select-usb-device')!(...[guards[2]!.event, { deviceList: [{ deviceId: 'usb-a' }] }, (id: unknown) => { results.usb = id }] as never[])
  return { hid: results.hid, serial: results.serial, usb: results.usb, prevented: guards.map((guard) => guard.prevented) }
}

function display(handlers: Handlers, videoRequested: boolean): Promise<unknown> {
  return new Promise((resolve) => handlers.display({ videoRequested }, resolve))
}

test('allow: every handler grants and pickers choose the first candidate, exactly as before', async () => {
  const { handlers, asked } = fakeSession('allow')
  for (const permission of ['media', 'display-capture', 'geolocation', 'notifications', 'clipboard-read', 'fullscreen', 'pointerLock', 'hid']) {
    assert.equal(await request(handlers, permission), true, permission)
    assert.equal(handlers.check(contents, permission), true, permission)
  }
  assert.equal(handlers.device(), true)
  assert.deepEqual(pickers(handlers), { hid: 'hid-a', serial: 'port-a', usb: 'usb-a', prevented: [true, true, true] })
  assert.deepEqual(await display(handlers, true), { video: sources[0] })
  assert.deepEqual(await display(handlers, false), {})
  assert.deepEqual(asked, [], 'nothing reaches the chrome')
})

test('block: the four prompted kinds and device access are denied; the rest stays granted like Chrome', async () => {
  const { handlers, asked } = fakeSession('block')
  for (const permission of ['media', 'display-capture', 'geolocation', 'notifications']) {
    assert.equal(await request(handlers, permission), false, permission)
    assert.equal(handlers.check(contents, permission), false, permission)
  }
  for (const permission of ['clipboard-read', 'fullscreen', 'pointerLock', 'midi']) {
    assert.equal(await request(handlers, permission), true, permission)
    assert.equal(handlers.check(contents, permission), true, permission)
  }
  assert.equal(handlers.device(), false)
  assert.deepEqual(pickers(handlers), { hid: '', serial: '', usb: undefined, prevented: [true, true, true] })
  assert.deepEqual(await display(handlers, true), {})
  assert.deepEqual(asked, [])
})

test('ask: the four prompted kinds go to the chrome with tab and origin; everything else behaves like allow', async () => {
  const { handlers, asked } = fakeSession('ask')
  assert.equal(await request(handlers, 'geolocation'), true)
  assert.deepEqual(asked, [{ tabId: 'tab-7', origin: 'https://page.example', permission: 'geolocation' }])
  assert.equal(await request(handlers, 'clipboard-read'), true)
  assert.equal(asked.length, 1)
  assert.equal(handlers.check(contents, 'notifications'), true)
  assert.equal(handlers.device(), true)
  assert.deepEqual(pickers(handlers).hid, 'hid-a')
  assert.deepEqual(await display(handlers, true), { video: sources[0] })

  const denied = fakeSession('ask', async () => false)
  assert.equal(await request(denied.handlers, 'media'), false)
  const failing = fakeSession('ask', async () => { throw new Error('chrome gone') })
  assert.equal(await request(failing.handlers, 'media'), false, 'a broken asker denies rather than hangs')
})

test('the policy is read per request, so a settings change applies without reinstalling', async () => {
  let policy: WebPermissionPolicy = 'allow'
  const handlers = { events: new Map<string, AnyFn>() } as Handlers
  const session = {
    setPermissionRequestHandler: (handler: Handlers['request']) => { handlers.request = handler },
    setPermissionCheckHandler: () => {}, setDevicePermissionHandler: () => {}, setDisplayMediaRequestHandler: () => {}, on: () => {}
  } as unknown as Session
  installPermissionPolicy(session, { policy: () => policy, ask: async () => true, tabIdFor: () => null, captureSources: async () => [] })
  assert.equal(await request(handlers, 'media'), true)
  policy = 'block'
  assert.equal(await request(handlers, 'media'), false)
})

test('the bluetooth picker on a WebContents follows the same policy', () => {
  const picks: unknown[] = []
  let handler: AnyFn | undefined
  const fake = { on: (_name: string, listener: AnyFn) => { handler = listener } } as unknown as WebContents
  let policy: WebPermissionPolicy = 'allow'
  installContentsPermissionPolicy(fake, () => policy)
  const guard = preventable()
  handler!(...[guard.event, [{ deviceId: 'bt-a' }], (id: unknown) => picks.push(id)] as never[])
  policy = 'block'
  handler!(...[guard.event, [{ deviceId: 'bt-a' }], (id: unknown) => picks.push(id)] as never[])
  assert.deepEqual(picks, ['bt-a', ''])
  assert.equal(guard.prevented, true)
})
