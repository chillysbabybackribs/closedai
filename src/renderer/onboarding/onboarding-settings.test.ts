import assert from 'node:assert/strict'
import test from 'node:test'

import {
  completedOnboardingSettings,
  createLocalUser,
  LEGACY_BYPASS_PROFILE_ID,
  normalizeOnboardingSettings,
  patchLocalUser,
  phaseForUser,
  readOnboardingSettings,
  signOutSession,
  writeOnboardingSettings
} from './onboarding-settings.js'
import { ONBOARDING_STORAGE_KEY } from '../../shared/onboarding.js'

test('createLocalUser trims the display name and assigns a stable hue', () => {
  const user = createLocalUser('  Ada  ', 'user-1', 'hash-a', 100)
  assert.equal(user.displayName, 'Ada')
  assert.equal(user.avatarHue, user.avatarHue)
  assert.equal(createLocalUser('user-1', 'user-1', 'hash-b', 100).avatarHue, user.avatarHue)
  assert.deepEqual(user.connectedProviders, [])
  assert.equal(user.providerSetupComplete, false)
})

test('normalizeOnboardingSettings migrates legacy global provider fields onto each user', () => {
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
  assert.deepEqual(normalized.users[0]?.connectedProviders, ['codex'])
  assert.equal(normalized.users[0]?.keepSignedIn, false)
})

test('per-user provider progress is independent after migration', () => {
  const ada = createLocalUser('Ada', 'ada', 'hash')
  const bob = createLocalUser('Bob', 'bob', 'hash')
  bob.providerSetupComplete = true
  bob.connectedProviders = ['claude']
  assert.equal(phaseForUser(ada, true), 'providers')
  assert.equal(phaseForUser(bob, true), 'done')
})

test('signOutSession returns to the gate without deleting profiles', () => {
  const user = createLocalUser('Ada', 'id-1', 'hash')
  user.providerSetupComplete = true
  user.connectedProviders = ['codex']
  const signedIn = {
    phase: 'done' as const,
    users: [user],
    activeUserId: 'id-1',
    sessionUnlocked: true
  }
  const signedOut = signOutSession(signedIn)
  assert.equal(signedOut.phase, 'gate')
  assert.equal(signedOut.sessionUnlocked, false)
  assert.equal(signedOut.activeUserId, null)
  assert.equal(signedOut.users[0]?.providerSetupComplete, true)
})

test('completedOnboardingSettings includes a legacy local profile for sign-out', () => {
  const settings = completedOnboardingSettings()
  assert.equal(settings.sessionUnlocked, true)
  assert.equal(settings.activeUserId, LEGACY_BYPASS_PROFILE_ID)
  assert.equal(settings.users.length, 1)
  assert.equal(settings.users[0]?.displayName, 'Local profile')
})

test('patchLocalUser updates only the targeted profile', () => {
  const ada = createLocalUser('Ada', 'ada', 'hash')
  const bob = createLocalUser('Bob', 'bob', 'hash')
  const next = patchLocalUser(
    { phase: 'providers', users: [ada, bob], activeUserId: 'ada', sessionUnlocked: true },
    'bob',
    { connectedProviders: ['codex'] }
  )
  assert.deepEqual(next.users[0]?.connectedProviders, [])
  assert.deepEqual(next.users[1]?.connectedProviders, ['codex'])
})

test('read and write round-trip onboarding settings', () => {
  const storage = new Map<string, string>()
  const store = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) }
  }
  assert.equal(readOnboardingSettings(store), null)
  const user = createLocalUser('Test', 'id-1', 'hash')
  user.connectedProviders = ['claude']
  user.providerSetupComplete = true
  writeOnboardingSettings(store, {
    phase: 'done',
    users: [user],
    activeUserId: 'id-1',
    sessionUnlocked: true
  })
  assert.ok(storage.has(ONBOARDING_STORAGE_KEY))
  assert.equal(readOnboardingSettings(store)?.phase, 'done')
})
