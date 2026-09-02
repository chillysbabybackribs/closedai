import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  claimProfileInstance,
  type AppInstanceIdentity,
  type SingleInstanceApp
} from './app-single-instance.js'

const identity: AppInstanceIdentity = { profile: '/profiles/codeapp', checkout: '/repo', pid: 42 }

function harness(ownsLock: boolean) {
  let quit = 0
  let listener: Parameters<SingleInstanceApp['on']>[1] | null = null
  let sent: Record<string, unknown> | undefined
  const app: SingleInstanceApp = {
    requestSingleInstanceLock(additionalData) {
      sent = additionalData
      return ownsLock
    },
    on(_event, next) {
      listener = next
    },
    quit() {
      quit += 1
    }
  }
  return { app, quit: () => quit, listener: () => listener, sent: () => sent }
}

test('the first process owns the resolved profile and advertises its identity', () => {
  const h = harness(true)
  assert.equal(claimProfileInstance(h.app, identity, () => null), true)
  assert.deepEqual(h.sent(), identity)
  assert.equal(h.quit(), 0)
  assert.ok(h.listener(), 'the primary listens for later launch attempts')
})

test('a second process quits before startup instead of sharing the profile', () => {
  const h = harness(false)
  assert.equal(claimProfileInstance(h.app, identity, () => null), false)
  assert.equal(h.quit(), 1)
  assert.equal(h.listener(), null)
})

test('a later launch restores and focuses the existing window', () => {
  const h = harness(true)
  const calls: string[] = []
  claimProfileInstance(h.app, identity, () => ({
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    focus: () => calls.push('focus')
  }))
  h.listener()?.({}, [], '/repo', identity)
  assert.deepEqual(calls, ['restore', 'focus'])
})
