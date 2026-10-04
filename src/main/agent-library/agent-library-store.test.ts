import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BUILT_IN_AGENTS, LEGACY_BUILT_IN_KEYS, SAVED_AGENT_DESCRIPTION_MAX } from '../../shared/agent-library.js'
import { AgentLibraryStore } from './agent-library-store.js'

async function scratch(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'agent-library-')), 'agent-library.json')
}

test('a first open seeds the built-in agents and writes them; a later open keeps the file as is', async () => {
  const file = await scratch()
  const store = await AgentLibraryStore.open(file)
  assert.deepEqual(store.list().map((agent) => agent.name).sort(), BUILT_IN_AGENTS.map((agent) => agent.name).sort())
  const persisted = JSON.parse(await readFile(file, 'utf8')) as { version: number; agents: unknown[] }
  assert.equal(persisted.version, 1)
  assert.equal(persisted.agents.length, BUILT_IN_AGENTS.length)
  for (const agent of store.list()) store.remove(agent.id)
  await store.flush()
  const reopened = await AgentLibraryStore.open(file)
  assert.deepEqual(reopened.list(), [], 'an emptied library is the user\'s choice, not a reason to re-seed')
})

test('a library from before a built-in shipped is offered it once; deleting it sticks', async () => {
  const file = await scratch()
  await writeFile(file, JSON.stringify({ version: 1, agents: [{ id: 'mine', name: 'Mine', prompt: 'Go.', createdAt: 5 }] }))
  const store = await AgentLibraryStore.open(file)
  const added = BUILT_IN_AGENTS.filter((agent) => !LEGACY_BUILT_IN_KEYS.includes(agent.key)).map((agent) => agent.name)
  assert.ok(added.length > 0)
  assert.deepEqual(store.list().map((agent) => agent.name).sort(), ['Mine', ...added].sort(), 'legacy built-ins are not re-added')
  for (const agent of store.list()) if (agent.name !== 'Mine') store.remove(agent.id)
  await store.flush()
  const persisted = JSON.parse(await readFile(file, 'utf8')) as { offered: string[] }
  assert.deepEqual(persisted.offered.sort(), BUILT_IN_AGENTS.map((agent) => agent.key).sort())
  const reopened = await AgentLibraryStore.open(file)
  assert.deepEqual(reopened.list().map((agent) => agent.name), ['Mine'])
})

test('save, update, recordRun and remove keep the list ordered by last use and announce changes', async () => {
  let clock = 1_000
  const store = await AgentLibraryStore.open(await scratch(), () => clock)
  const changes: number[] = []
  store.on('changed', (agents: unknown[]) => changes.push(agents.length))
  clock = 2_000
  const triage = store.save({ name: '  Triage  bot ', prompt: '  Sort issues. ', maxCycles: 4 })
  assert.equal(triage.name, 'Triage bot')
  assert.equal(triage.prompt, 'Sort issues.')
  assert.equal(triage.maxCycles, 4)
  assert.equal(store.list()[0]!.id, triage.id, 'the newest entry leads until something else runs')
  clock = 3_000
  const repair = store.list().find((agent) => agent.name === 'Repair agent')!
  store.recordRun(repair.id)
  assert.equal(store.list()[0]!.id, repair.id)
  assert.equal(store.get(repair.id)!.runCount, 1)
  assert.equal(store.get(repair.id)!.lastRunAt, 3_000)
  clock = 4_000
  const updated = store.update(triage.id, { maxCycles: 0, prompt: 'Sort and label issues.' })
  assert.equal(updated!.maxCycles, null, 'zero means no cap')
  assert.equal(updated!.updatedAt, 4_000)
  assert.equal(store.update('missing', { name: 'x' }), null)
  store.recordRun('missing')
  store.remove(triage.id)
  assert.equal(store.get(triage.id), null)
  assert.deepEqual(changes, [BUILT_IN_AGENTS.length + 1, BUILT_IN_AGENTS.length + 1, BUILT_IN_AGENTS.length + 1, BUILT_IN_AGENTS.length])
})

test('saving refuses a blank name or blank instructions', async () => {
  const store = await AgentLibraryStore.open(await scratch())
  assert.throws(() => store.save({ name: '  ', prompt: 'Go.' }), /name/)
  assert.throws(() => store.save({ name: 'Blank', prompt: '  ' }), /instructions/)
  const repair = store.list()[0]!
  assert.throws(() => store.update(repair.id, { name: '' }), /name/)
})

test('a malformed file starts clean, and broken entries are dropped on read', async () => {
  const file = await scratch()
  await writeFile(file, JSON.stringify({ version: 1, offered: BUILT_IN_AGENTS.map((agent) => agent.key), agents: [
    { id: 'ok', name: 'Kept', prompt: 'Do it.', maxCycles: 'many', createdAt: 5, runCount: -1 },
    { id: 'no-name', name: '', prompt: 'x' },
    'junk'
  ] }))
  const store = await AgentLibraryStore.open(file)
  assert.deepEqual(store.list().map((agent) => [agent.name, agent.maxCycles, agent.updatedAt, agent.runCount]), [['Kept', null, 5, 0]])
  await writeFile(file, '{not json')
  const clean = await AgentLibraryStore.open(file)
  assert.deepEqual(clean.list().map((agent) => agent.name).sort(), BUILT_IN_AGENTS.map((agent) => agent.name).sort(), 'unreadable counts as first open')
})

test('the description and run settings are kept; entries from before they existed load with today\'s behavior', async () => {
  const file = await scratch()
  await writeFile(file, JSON.stringify({ version: 1, offered: BUILT_IN_AGENTS.map((agent) => agent.key), agents: [
    { id: 'old', name: 'Old', prompt: 'Go.', maxCycles: 3, createdAt: 5 }
  ] }))
  const store = await AgentLibraryStore.open(file)
  const old = store.get('old')!
  assert.deepEqual([old.description, old.maxMinutes, old.autonomous, old.maxCycles], ['', null, true, 3])
  const saved = store.save({ name: 'Docs', description: '  keep docs/ in step with src/  ', prompt: 'Each cycle…', maxMinutes: 90, autonomous: false })
  assert.deepEqual([saved.description, saved.maxMinutes, saved.autonomous], ['keep docs/ in step with src/', 90, false])
  const edited = store.update(saved.id, { prompt: 'Each cycle, read the ledger…' })!
  assert.equal(edited.description, 'keep docs/ in step with src/', 'editing the instructions never drops the description')
  assert.equal(edited.autonomous, false)
  assert.equal(store.update(saved.id, { maxMinutes: null, autonomous: true })!.maxMinutes, null)
  assert.throws(() => store.update(saved.id, { description: 'x'.repeat(SAVED_AGENT_DESCRIPTION_MAX + 1) }), /descriptions are limited/)
  await store.flush()
  const reopened = await AgentLibraryStore.open(file)
  assert.equal(reopened.get(saved.id)!.description, 'keep docs/ in step with src/')
})
