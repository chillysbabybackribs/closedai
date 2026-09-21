import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { chatRecord, harnessWith } from './peer-manager-harness.js'

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'closedai-chat-project-'))
  const target = join(directory, 'target')
  await mkdir(target)
  const h = harnessWith(['a', 'b'].map((id) => chatRecord(id, 'gpt', {
    threadId: `${id}-thread`, codexThreadId: `${id}-thread`, preview: 'Existing conversation'
  })), 'a')
  for (const [index, surface] of h.surfaces.entries()) {
    const id = index === 0 ? 'a' : 'b'
    surface.state.threadId = `${id}-thread`
    surface.state.items = [{ type: 'user', id: `${id}-prompt`, turnId: null, text: 'Keep working on this task' }]
  }
  await h.manager.setVisiblePanes('/workspace', ['a', 'b'], ['a', 'b'])
  t.after(async () => { h.manager.stop(); await rm(directory, { recursive: true, force: true }) })
  return { ...h, target, directory }
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++) await setTimeout(5)
  assert.ok(predicate(), 'directory change completed')
}

test('changing one chat keeps both visible, preserves its transcript, and leaves the other running', async (t) => {
  const h = await fixture(t)
  const [a, b] = h.surfaces
  await h.manager.send('b', 'work on the other task', [])
  await h.manager.selectChatProject('a', h.target)
  const view = h.manager.snapshot({ limit: 60 })
  assert.equal(view.selectedPaneId, 'a')
  assert.deepEqual(Object.keys(view.panes!).sort(), ['a', 'b'])
  assert.equal(view.selected.cwd, h.target)
  assert.deepEqual(view.selected.items.map((item) => item.id), ['a-prompt'])
  assert.equal(h.settings.get().chatWorkspacePath, '/workspace')
  assert.deepEqual(h.settings.get().chatOpenIds, ['b', 'a'])
  assert.equal(h.store.require('b').cwd, '/workspace')
  assert.equal(b!.state.activeTurnId, 'turn:work on the other task')
  assert.ok(!b!.calls.includes('stop'))
  assert.ok(a!.calls.includes('stop'))
  assert.match(h.store.require('a').continuation!.handoff!, /Keep working on this task/)
  assert.equal(h.store.require('a').continuation!.sourceThroughItemId, 'a-prompt')
  await h.manager.selectPane('b')
  await h.manager.selectPane('a')
  assert.equal(h.settings.get().chatWorkspacePath, '/workspace')
  await h.manager.send('a', 'continue here', [])
  assert.ok(h.surfaces.at(-1)!.calls.includes('send:continue here'))
  assert.ok(!a!.calls.includes('send:continue here'))
})

test('a folder selected during a turn applies when that chat finishes, while its neighbor keeps running', async (t) => {
  const h = await fixture(t)
  await h.manager.send('a', 'first', [])
  await h.manager.send('b', 'second', [])
  await h.manager.selectChatProject('a', h.target)
  assert.equal(h.store.require('a').cwd, '/workspace')
  assert.equal(h.manager.snapshot().chats.find((row) => row.paneId === 'a')?.pendingProject?.cwd, h.target)
  assert.equal(h.surfaces.length, 2)
  h.surfaces[0]!.state.activeTurnId = null
  h.surfaces[0]!.emit('event', { type: 'turn', turnId: null })
  await until(() => h.store.require('a').cwd === h.target)
  assert.equal(h.surfaces[1]!.state.activeTurnId, 'turn:second')
  assert.ok(!h.surfaces[1]!.calls.includes('stop'))
  await until(() => !h.manager.snapshot().chats.find((row) => row.paneId === 'a')?.pendingProject)
})

test('choosing the current folder cancels a queued change and invalid directories leave the chat alone', async (t) => {
  const h = await fixture(t)
  await h.manager.selectChatProject('a', h.target)
  await h.manager.send('a', 'work', [])
  await h.manager.selectChatProject('a', h.directory)
  await h.manager.selectChatProject('a', h.target)
  assert.equal(h.manager.snapshot().chats.find((row) => row.paneId === 'a')?.pendingProject, undefined)
  await assert.rejects(h.manager.selectChatProject('a', join(h.target, 'missing')), /ENOENT/)
  assert.equal(h.store.require('a').cwd, h.target)
})

test('new chats inherit the focused chat directory, and mixed directories survive restoring open chats', async (t) => {
  const h = await fixture(t)
  await h.manager.selectChatProject('a', h.target)
  const fresh = await h.manager.newPeer()
  assert.equal(h.store.require(fresh).cwd, h.target)
  const restored = harnessWith(h.store.ids().map((id) => h.store.require(id)), 'a', undefined, h.settings.get().chatOpenIds)
  t.after(() => restored.manager.stop())
  assert.deepEqual(restored.manager.snapshot().chats.map((row) => row.paneId).sort(), h.store.ids().sort())
  await h.manager.selectChatProject('a', null)
  assert.equal(h.store.require('a').cwd, homedir())
  assert.equal(h.store.require('a').projectPath, null)
  assert.equal(h.store.require('b').cwd, '/workspace')
})
