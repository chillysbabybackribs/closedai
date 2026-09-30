import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { PROFILE_REGISTRY_FILE, readProfileRegistry } from './profile-registry.js'
import { purgeRemovedProfiles } from './profile-removal.js'
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

function names(onboardingJson: string | null): string[] {
  return (JSON.parse(onboardingJson ?? '{"users":[]}') as { users: Array<{ id: string }> }).users.map((user) => user.id)
}

test('deleting an account whose data is closed sets the data aside at once', async () => {
  const dir = root()
  const session = ProfileSession.open(dir)
  session.write(onboarding(null, [ADA, BOB]))
  mkdirSync(join(dir, 'profiles', 'bob'), { recursive: true })
  writeFileSync(join(dir, 'profiles', 'bob', 'chats.json'), '{}')

  const result = session.remove('bob')
  assert.deepEqual({ removed: result.removed, relaunching: result.relaunching }, { removed: true, relaunching: false })
  assert.deepEqual(names(result.onboarding), ['ada'])
  assert.equal(existsSync(join(dir, 'profiles', 'bob')), false)
  assert.equal(readdirSync(join(dir, 'profiles')).length, 1)

  const trashed: string[] = []
  await purgeRemovedProfiles(dir, async (path) => { trashed.push(path) })
  assert.equal(trashed.length, 1)
  assert.match(trashed[0]!, /\.deleted-\d+-bob$/)
  assert.equal(session.remove('bob').removed, false)
})

test('deleting the open account waits for the relaunch, which opens without its data', () => {
  const dir = root()
  const first = ProfileSession.open(dir)
  first.write(onboarding('bob', [ADA, BOB]))
  first.prepareSwitch('bob')
  const open = ProfileSession.open(dir)
  mkdirSync(open.dataDir, { recursive: true })
  writeFileSync(join(open.dataDir, 'chats.json'), '{}')
  open.write(onboarding(null, [ADA, BOB]))

  const result = open.remove('bob')
  assert.equal(result.relaunching, true)
  assert.equal(existsSync(join(open.dataDir, 'chats.json')), true)

  const next = ProfileSession.open(dir)
  assert.equal(next.dataDir, dir)
  assert.equal(existsSync(join(dir, 'profiles', 'bob')), false)
  assert.deepEqual(readProfileRegistry(dir).pendingRemovals, [])
})

test('a deleted home account takes its files and never hands the root to another account', () => {
  const dir = root()
  const session = ProfileSession.open(dir)
  session.write(onboarding(null, [ADA, BOB]))
  writeFileSync(join(dir, 'chats.json'), '{}')
  mkdirSync(join(dir, 'profiles', 'bob'), { recursive: true })
  writeFileSync(join(dir, 'profiles', 'bob', 'chats.json'), '{"bob":true}')

  assert.equal(session.remove('ada').relaunching, true)
  const next = ProfileSession.open(dir)
  assert.equal(existsSync(join(dir, 'chats.json')), false)
  assert.equal(existsSync(join(dir, 'profiles.json')), true)
  assert.equal(readFileSync(join(dir, 'profiles', 'bob', 'chats.json'), 'utf8'), '{"bob":true}')

  next.write(onboarding('bob', [BOB]))
  assert.equal(next.prepareSwitch('bob'), true)
  assert.equal(ProfileSession.open(dir).dataDir, join(dir, 'profiles', 'bob'))
})

test('data the trash refuses is deleted', async () => {
  const dir = root()
  const session = ProfileSession.open(dir)
  session.write(onboarding(null, [ADA, BOB]))
  mkdirSync(join(dir, 'profiles', 'bob'), { recursive: true })
  session.remove('bob')
  await purgeRemovedProfiles(dir, async () => { throw new Error('no trash') })
  assert.deepEqual(readdirSync(join(dir, 'profiles')), [])
})
