import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { PROFILE_REGISTRY_FILE, readProfileRegistry } from './profile-registry.js'
import { ProfileSession } from './profile-session.js'

function root(): string {
  return mkdtempSync(join(tmpdir(), 'closedai-profiles-'))
}

function onboarding(activeUserId: string | null, users: Array<{ id: string; createdAt: number }>): string {
  return JSON.stringify({
    phase: activeUserId ? 'done' : 'gate',
    users: users.map((user) => ({ ...user, displayName: user.id })),
    activeUserId,
    sessionUnlocked: activeUserId !== null
  })
}

const ADA = { id: 'ada', createdAt: 1 }
const BOB = { id: 'bob', createdAt: 2 }

test('a fresh install opens the root and gives it to the first account', () => {
  const dir = root()
  const session = ProfileSession.open(dir)
  assert.equal(session.dataDir, dir)
  assert.deepEqual(session.bootstrap(), { currentUserId: null, onboarding: null, resumed: false })
  assert.deepEqual(session.write(onboarding('ada', [ADA])), { currentUserId: 'ada' })
  assert.equal(session.prepareSwitch('ada'), false)
  assert.equal(readProfileRegistry(dir).homeUserId, 'ada')
})

test('data that predates profiles stays with the oldest account', () => {
  const dir = root()
  const session = ProfileSession.open(dir)
  // The imported list has a newer account signed in; the root is still the oldest account's.
  assert.deepEqual(session.write(onboarding('bob', [BOB, ADA])), { currentUserId: 'ada' })
  assert.equal(session.prepareSwitch('bob'), true)
})

test('a second account gets its own directory and the switch resumes once', () => {
  const dir = root()
  const first = ProfileSession.open(dir)
  first.write(onboarding('ada', [ADA]))
  first.write(onboarding('bob', [ADA, BOB]))
  assert.equal(first.prepareSwitch('bob'), true)

  const second = ProfileSession.open(dir)
  assert.equal(second.dataDir, join(dir, 'profiles', 'bob'))
  assert.equal(second.bootstrap().currentUserId, 'bob')
  assert.equal(second.bootstrap().resumed, true)
  assert.equal(second.prepareSwitch('bob'), false)

  const third = ProfileSession.open(dir)
  assert.equal(third.dataDir, join(dir, 'profiles', 'bob'))
  assert.equal(third.bootstrap().resumed, false)
})

test('signing out keeps the next launch on the last account', () => {
  const dir = root()
  const session = ProfileSession.open(dir)
  session.write(onboarding('ada', [ADA]))
  session.write(onboarding('bob', [ADA, BOB]))
  session.write(onboarding(null, [ADA, BOB]))
  assert.equal(ProfileSession.open(dir).dataDir, join(dir, 'profiles', 'bob'))
})

test('a switch is refused for an account that is unknown or not signed in', () => {
  const dir = root()
  const session = ProfileSession.open(dir)
  session.write(onboarding('ada', [ADA, BOB]))
  assert.equal(session.prepareSwitch('bob'), false)
  assert.equal(session.prepareSwitch('../etc'), false)
  assert.equal(session.prepareSwitch('carol'), false)
})

test('the registry is private, and an unreadable one is set aside', () => {
  const dir = root()
  ProfileSession.open(dir).write(onboarding('ada', [ADA]))
  const path = join(dir, PROFILE_REGISTRY_FILE)
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.equal(typeof JSON.parse(readFileSync(path, 'utf8')).onboarding, 'string')

  writeFileSync(path, '{ not json')
  const session = ProfileSession.open(dir)
  assert.equal(session.bootstrap().onboarding, null)
  assert.throws(() => statSync(path))
})
