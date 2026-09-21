import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SECURITY_SETTINGS, type SecuritySettings } from '../../shared/security.js'
import {
  SECURITY_API_UNAVAILABLE,
  createSecurityController,
  describeCookieImport,
  type SecurityApi
} from './security-settings.js'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fakeApi(initial: Partial<SecuritySettings> = {}): SecurityApi & { stored: SecuritySettings; patches: Array<Partial<SecuritySettings>> } {
  const api = {
    stored: { ...DEFAULT_SECURITY_SETTINGS, ...initial },
    patches: [] as Array<Partial<SecuritySettings>>,
    get: async () => ({ ...api.stored }),
    set: async (patch: Partial<SecuritySettings>) => {
      api.patches.push(patch)
      api.stored = { ...api.stored, ...patch }
      return { ...api.stored }
    },
    importCookies: async () => ({ source: 'Chrome', imported: 312, failed: 0, skipped: 4 })
  }
  return api
}

test('load reads the stored settings and marks the state loaded', async () => {
  const api = fakeApi({ webPermissions: 'ask' })
  const controller = createSecurityController(api)
  assert.equal(controller.getState().loaded, false)
  await controller.load()
  assert.equal(controller.getState().loaded, true)
  assert.equal(controller.getState().settings.webPermissions, 'ask')
  assert.equal(controller.getState().error, null)
})

test('a superseded load does not overwrite the newer answer', async () => {
  const first = deferred<SecuritySettings>()
  let calls = 0
  const api: SecurityApi = {
    get: () => (++calls === 1 ? first.promise : Promise.resolve({ ...DEFAULT_SECURITY_SETTINGS, webPermissions: 'block' })),
    set: async () => DEFAULT_SECURITY_SETTINGS,
    importCookies: async () => ({ source: null, imported: 0, failed: 0, skipped: 0 })
  }
  const controller = createSecurityController(api)
  const stale = controller.load()
  await controller.load()
  first.resolve({ ...DEFAULT_SECURITY_SETTINGS, webPermissions: 'ask' })
  await stale
  assert.equal(controller.getState().settings.webPermissions, 'block')
})

test('update applies the patch before the write completes and keeps the saved answer', async () => {
  const api = fakeApi()
  const controller = createSecurityController(api)
  await controller.load()
  let notified = 0
  controller.subscribe(() => { notified += 1 })
  const pending = controller.update({ credentialsRequireApproval: true })
  assert.equal(controller.getState().settings.credentialsRequireApproval, true)
  await pending
  assert.deepEqual(api.patches, [{ credentialsRequireApproval: true }])
  assert.equal(controller.getState().settings.credentialsRequireApproval, true)
  assert.ok(notified >= 2)
})

test('a refused write rolls back only the keys it touched and reports the reason', async () => {
  const api = fakeApi()
  api.set = async (patch) => {
    if ('secretsRequireKeychain' in patch) throw new Error("Error invoking remote method 'security:set': keychain is locked")
    api.stored = { ...api.stored, ...patch }
    return { ...api.stored }
  }
  const controller = createSecurityController(api)
  await controller.load()
  const failing = controller.update({ secretsRequireKeychain: true })
  await controller.update({ webPermissions: 'block' })
  await failing
  const { settings, error } = controller.getState()
  assert.equal(settings.secretsRequireKeychain, false)
  assert.equal(settings.webPermissions, 'block')
  assert.equal(error, 'keychain is locked')
})

test('the next successful write clears an earlier error', async () => {
  const api = fakeApi()
  const original = api.set
  api.set = async () => { throw new Error('nope') }
  const controller = createSecurityController(api)
  await controller.update({ importBrowserCookies: false })
  assert.equal(controller.getState().error, 'nope')
  api.set = original
  await controller.update({ importBrowserCookies: false })
  assert.equal(controller.getState().error, null)
})

test('cookie import reports progress, then the result sentence', async () => {
  const gate = deferred<{ source: string | null; imported: number; failed: number; skipped: number }>()
  const api = fakeApi()
  api.importCookies = () => gate.promise
  const controller = createSecurityController(api)
  const run = controller.importCookies()
  assert.equal(controller.getState().importing, true)
  await controller.importCookies() // ignored while one is running
  gate.resolve({ source: 'Chrome', imported: 312, failed: 0, skipped: 0 })
  await run
  assert.equal(controller.getState().importing, false)
  assert.equal(controller.getState().importResult, 'Imported 312 cookies from Chrome')
})

test('a failed cookie import ends the running state with an error line', async () => {
  const api = fakeApi()
  api.importCookies = async () => { throw new Error('Cookies database is locked') }
  const controller = createSecurityController(api)
  await controller.importCookies()
  assert.equal(controller.getState().importing, false)
  assert.equal(controller.getState().importResult, null)
  assert.equal(controller.getState().error, 'Cookies database is locked')
})

test('describeCookieImport covers the empty, singular, and partial cases', () => {
  assert.equal(describeCookieImport({ source: null, imported: 0, failed: 0, skipped: 0 }), 'No supported browser found')
  assert.equal(describeCookieImport({ source: 'Chromium', imported: 1, failed: 0, skipped: 0 }), 'Imported 1 cookie from Chromium')
  assert.equal(describeCookieImport({ source: 'Chrome', imported: 20, failed: 3, skipped: 0 }), 'Imported 20 cookies from Chrome (3 failed)')
})

test('a missing API leaves defaults in place and says why', async () => {
  const controller = createSecurityController(null)
  await controller.load()
  assert.equal(controller.getState().error, SECURITY_API_UNAVAILABLE)
  await controller.update({ webPermissions: 'block' })
  assert.deepEqual(controller.getState().settings, DEFAULT_SECURITY_SETTINGS)
  await controller.importCookies()
  assert.equal(controller.getState().importing, false)
})
