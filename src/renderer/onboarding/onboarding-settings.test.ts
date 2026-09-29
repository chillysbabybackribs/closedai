import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLocalUser,
  normalizeOnboardingSettings,
  readOnboardingSettings,
  writeOnboardingSettings
} from './onboarding-settings.js'
import { ONBOARDING_STORAGE_KEY } from '../../shared/onboarding.js'

test('createLocalUser trims the display name and assigns a stable hue', () => {
  const user = createLocalUser('  Ada  ', 'user-1', 100)
  assert.equal(user.displayName, 'Ada')
  assert.equal(user.avatarHue, user.avatarHue)
  assert.equal(createLocalUser('user-1', 'user-1', 100).avatarHue, user.avatarHue)
})

test('normalizeOnboardingSettings drops unknown providers and invalid active users', () => {
  const normalized = normalizeOnboardingSettings({
    phase: 'providers',
    users: [{ id: 'a', displayName: 'A', avatarHue: 10, createdAt: 1 }],
    activeUserId: 'missing',
    connectedProviders: ['codex', 'nope'],
    keepSignedIn: false,
    sessionUnlocked: true,
    providerSetupComplete: false
  })
  assert.equal(normalized.activeUserId, null)
  assert.deepEqual(normalized.connectedProviders, ['codex'])
  assert.equal(normalized.keepSignedIn, false)
})

test('read and write round-trip onboarding settings', () => {
  const storage = new Map<string, string>()
  const store = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) }
  }
  assert.equal(readOnboardingSettings(store), null)
  writeOnboardingSettings(store, {
    phase: 'done',
    users: [createLocalUser('Test', 'id-1')],
    activeUserId: 'id-1',
    keepSignedIn: true,
    sessionUnlocked: true,
    connectedProviders: ['claude'],
    providerSetupComplete: true
  })
  assert.ok(storage.has(ONBOARDING_STORAGE_KEY))
  assert.equal(readOnboardingSettings(store)?.phase, 'done')
})
