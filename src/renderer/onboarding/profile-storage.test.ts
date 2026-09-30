import assert from 'node:assert/strict'
import test from 'node:test'

import { ONBOARDING_STORAGE_KEY } from '../../shared/onboarding.js'
import type { ProfileBootstrap } from '../../shared/local-profiles.js'
import { createProfileStorage } from './profile-storage.js'

function legacyStorage(initial: string | null): { getItem: (key: string) => string | null; removeItem: (key: string) => void; value: () => string | null } {
  let stored = initial
  return {
    getItem: (key) => (key === ONBOARDING_STORAGE_KEY ? stored : null),
    removeItem: (key) => { if (key === ONBOARDING_STORAGE_KEY) stored = null },
    value: () => stored
  }
}

function bridge(boot: ProfileBootstrap, owner: string | null): { bootstrap: () => ProfileBootstrap; write: (value: string) => { currentUserId: string | null }; writes: string[] } {
  const writes: string[] = []
  return {
    bootstrap: () => boot,
    write: (value) => { writes.push(value); return { currentUserId: owner } },
    writes
  }
}

test('the list an earlier build kept in localStorage moves to main once', () => {
  const legacy = legacyStorage('{"users":[]}')
  const main = bridge({ currentUserId: null, onboarding: null, resumed: false }, 'ada')
  const storage = createProfileStorage(main, legacy)
  assert.deepEqual(main.writes, ['{"users":[]}'])
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), '{"users":[]}')
  assert.equal(storage.currentUserId(), 'ada')
  assert.equal(legacy.value(), null)
})

test('the list main holds wins over a leftover localStorage copy', () => {
  const legacy = legacyStorage('{"stale":true}')
  const main = bridge({ currentUserId: 'bob', onboarding: '{"fresh":true}', resumed: true }, 'bob')
  const storage = createProfileStorage(main, legacy)
  assert.deepEqual(main.writes, [])
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), '{"fresh":true}')
  assert.equal(storage.resumed(), true)
  assert.equal(legacy.value(), null)
})

test('a fresh install reads as absent until the first write', () => {
  const main = bridge({ currentUserId: null, onboarding: null, resumed: false }, 'ada')
  const storage = createProfileStorage(main, legacyStorage(null))
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), null)
  assert.equal(storage.currentUserId(), null)
  storage.setItem(ONBOARDING_STORAGE_KEY, '{"users":[1]}')
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), '{"users":[1]}')
  assert.equal(storage.currentUserId(), 'ada')
})
