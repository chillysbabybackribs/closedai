import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import {
  CLOSEDAI_WORK_LOCK_SCRIPT_ENV,
  CLOSEDAI_WORKSPACE_CWD_ENV,
  buildProviderChildEnv,
  providerWorkLockPaths
} from './provider-work-env.ts'
import { setAppCheckoutPath } from './app-checkout.ts'
import { VERIFY_LEASE_ENV } from './verify-janitor.ts'

test('provider child env prepends work-lock shims and verify lease', () => {
  const checkout = join('/repo', 'closedai')
  setAppCheckoutPath(checkout)
  const env = buildProviderChildEnv({ workspaceCwd: '/proj', paneId: 'pane-a' })
  assert.equal(env[CLOSEDAI_WORKSPACE_CWD_ENV], '/proj')
  assert.equal(env[CLOSEDAI_WORK_LOCK_SCRIPT_ENV], join(checkout, 'scripts', 'work-lock.mjs'))
  assert.match(String(env.PATH), new RegExp(`${join(checkout, 'scripts', 'closedai-bin').replaceAll('/', '\\/')}`))
  assert.match(String(env[VERIFY_LEASE_ENV]), /^pane-a:\d+$/)
})

test('work lock wiring can be disabled', () => {
  setAppCheckoutPath('/repo')
  const before = process.env.PATH ?? ''
  const env = buildProviderChildEnv({ workspaceCwd: '/proj', workLockEnabled: false })
  assert.equal(env[CLOSEDAI_WORKSPACE_CWD_ENV], '/proj')
  assert.equal(env[CLOSEDAI_WORK_LOCK_SCRIPT_ENV], undefined)
  assert.equal(env.PATH, before)
})

test('providerWorkLockPaths resolves checkout-relative scripts', () => {
  const paths = providerWorkLockPaths('/checkout')
  assert.equal(paths.lockScript, join('/checkout', 'scripts', 'work-lock.mjs'))
  assert.equal(paths.shimDir, join('/checkout', 'scripts', 'closedai-bin'))
})
