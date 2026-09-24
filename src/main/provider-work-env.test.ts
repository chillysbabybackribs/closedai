import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import {
  CLOSEDAI_REAL_NODE_ENV,
  CLOSEDAI_SHIM_BIN_DIR_ENV,
  CLOSEDAI_WORK_LOCK_SCRIPT_ENV,
  CLOSEDAI_WORKSPACE_CWD_ENV,
  buildProviderChildEnv,
  providerWorkLockPaths
} from './provider-work-env.ts'
import { setAppCheckoutPath } from './app-checkout.ts'
import { VERIFY_LEASE_ENV } from './verify-janitor.ts'
import { resetProviderWorkEnvCacheForTests } from './provider-work-env.ts'

test('provider child env prepends work-lock shims and verify lease', () => {
  resetProviderWorkEnvCacheForTests()
  const checkout = join('/repo', 'closedai')
  setAppCheckoutPath(checkout)
  const env = buildProviderChildEnv({ workspaceCwd: '/proj', paneId: 'pane-a' })
  assert.equal(env[CLOSEDAI_WORKSPACE_CWD_ENV], '/proj')
  assert.equal(env[CLOSEDAI_WORK_LOCK_SCRIPT_ENV], join(checkout, 'scripts', 'work-lock.mjs'))
  assert.match(String(env.PATH), new RegExp(`${join(checkout, 'scripts', 'closedai-bin').replaceAll('/', '\\/')}`))
  assert.match(String(env[VERIFY_LEASE_ENV]), /^pane-a:\d+$/)
  assert.equal(env[CLOSEDAI_SHIM_BIN_DIR_ENV], join(checkout, 'scripts', 'closedai-bin'))
  assert.match(String(env[CLOSEDAI_REAL_NODE_ENV]), /node/)
})

test('work lock wiring can be disabled', () => {
  resetProviderWorkEnvCacheForTests()
  setAppCheckoutPath('/repo')
  const env = buildProviderChildEnv({ workspaceCwd: '/proj', workLockEnabled: false })
  assert.equal(env[CLOSEDAI_WORKSPACE_CWD_ENV], '/proj')
  assert.equal(env[CLOSEDAI_SHIM_BIN_DIR_ENV], undefined)
  assert.equal(env[CLOSEDAI_WORK_LOCK_SCRIPT_ENV], undefined)
})

test('providerWorkLockPaths resolves checkout-relative scripts', () => {
  const paths = providerWorkLockPaths('/checkout')
  assert.equal(paths.lockScript, join('/checkout', 'scripts', 'work-lock.mjs'))
  assert.equal(paths.shimDir, join('/checkout', 'scripts', 'closedai-bin'))
})
