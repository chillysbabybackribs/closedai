import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_SECURITY_SETTINGS, normalizeSecuritySettings } from './security.js'

test('the defaults are the unrestricted behavior: no approval, no keychain requirement, allow all, import cookies', () => {
  assert.deepEqual(DEFAULT_SECURITY_SETTINGS, {
    credentialsRequireApproval: false,
    secretsRequireKeychain: false,
    webPermissions: 'allow',
    importBrowserCookies: true
  })
})

test('missing, malformed, or foreign values fall back to the defaults field by field', () => {
  assert.deepEqual(normalizeSecuritySettings(undefined), DEFAULT_SECURITY_SETTINGS)
  assert.deepEqual(normalizeSecuritySettings('nope'), DEFAULT_SECURITY_SETTINGS)
  assert.deepEqual(normalizeSecuritySettings({ webPermissions: 'prompt', credentialsRequireApproval: 'yes' }), DEFAULT_SECURITY_SETTINGS)
  assert.deepEqual(
    normalizeSecuritySettings({ webPermissions: 'block', secretsRequireKeychain: true, extra: 1 }),
    { ...DEFAULT_SECURITY_SETTINGS, webPermissions: 'block', secretsRequireKeychain: true }
  )
})
