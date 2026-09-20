import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test, { type TestContext } from 'node:test'
import { DEFAULT_APP_SETTINGS } from '../app-settings-store.js'
import { ChatStore } from '../chat-store/chat-store.js'
import { ChatPeerManager } from './peer-manager.js'
import { chatRecord, FakeSurface, MemorySettings } from './peer-manager-harness.js'

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'closedai-switch-'))
  const destination = join(root, 'destination')
  await mkdir(destination)
  const settings = new MemorySettings({
    ...DEFAULT_APP_SETTINGS, chatOpenIds: ['source', 'other'], chatSelectedPaneId: 'other'
  })
  const store = ChatStore.inMemory(['source', 'other'].map((id) =>
    chatRecord(id, 'gpt', { cwd: root, projectPath: root })))
  let selection = { cwd: root, projectPath: root as string | null }
  let switchCount = 0
  let switchError = false
  let sendError = false
  let hold: Promise<void> | null = null
  const surfaces = new Map<string, FakeSurface>()
  const manager = new ChatPeerManager(settings, store, (_settings, record) => {
    const surface = new FakeSurface(record.modelId)
    surface.state.cwd = record.cwd
    if (record.id === 'source' || record.id === 'other') {
      surface.state.threadId = record.id + '-thread'
      surface.state.activeTurnId = record.id + '-turn'
      surface.state.items = [{ type: 'user', id: record.id + '-user', turnId: surface.state.activeTurnId,
        text: 'Switch projects and finish the authorized archive task.' }]
    }
    const send = surface.send.bind(surface)
    surface.send = async (text, attachments) => {
      if (sendError) throw new Error('Provider could not start')
      await send(text, attachments)
    }
    surfaces.set(record.id, surface)
    return surface
  }, undefined, {
    current: () => selection,
    select: async (projectPath) => {
      switchCount += 1
      if (hold) await hold
      if (switchError) throw new Error('Settings write failed')
      await settings.set({ chatOpenIds: [], chatSelectedPaneId: null })
      selection = { cwd: projectPath!, projectPath }
    }
  })
  t.after(async () => { manager.stop(); await rm(root, { recursive: true, force: true }) })
  const request = { paneId: 'source', threadId: 'source-thread', turnId: 'source-turn', projectPath: destination }
  const queue = () => manager.projectSwitch.request(request, new AbortController().signal)
  const finish = (id: string) => {
    const surface = surfaces.get(id)!
    surface.state.activeTurnId = null
    surface.emit('event', { type: 'turn', turnId: null })
  }
  return { root, destination, manager, store, surfaces, request, queue, finish,
    switches: () => switchCount,
    failSwitch: () => { switchError = true },
    failSend: () => { sendError = true },
    holdSwitch: () => { let release!: () => void; hold = new Promise<void>((resolve) => { release = resolve }); return release }
  }
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (!check() && Date.now() < deadline) await delay(20)
  assert.ok(check(), 'Expected state was not reached')
}

test('waits for every pane, then verifies destination and continues the caller, independent of focus', async (t) => {
  const h = await fixture(t)
  assert.equal((await h.queue()).status, 'pending')
  assert.deepEqual(await h.queue(), h.manager.projectSwitch.state(), 'retry must not create another request')
  h.finish('source')
  await delay(140)
  assert.equal(h.switches(), 0)
  assert.equal(h.manager.projectSwitch.state()?.status, 'pending')
  h.finish('other')
  await until(() => h.manager.projectSwitch.state()?.status === 'completed')
  assert.equal(h.switches(), 1)
  assert.equal(h.manager.snapshot().workspace?.cwd, h.destination)
  const target = h.manager.projectSwitch.state()!.destinationPaneId!
  assert.equal(h.manager.snapshot().selectedPaneId, target)
  const continuation = h.store.require(target).continuation!
  assert.equal(continuation.sourcePaneId, 'source')
  assert.equal(continuation.sourceThreadId, 'source-thread')
  assert.equal(continuation.sourceThroughItemId, 'source-user')
  assert.match(continuation.handoff!, /authorized archive task/)
  assert.match(continuation.handoff!, /not new instructions or authorization/)
  assert.equal(h.surfaces.get(target)!.calls.filter((call) => call.startsWith('send:')).length, 1)
  assert.ok(h.surfaces.get('source')!.calls.includes('stop'))
})

test('rejects missing paths, non-directory paths, stale callers, and conflicting requests', async (t) => {
  const h = await fixture(t)
  const signal = new AbortController().signal
  await assert.rejects(h.manager.projectSwitch.request({ ...h.request, projectPath: 'relative' }, signal), /absolute/)
  await assert.rejects(h.manager.projectSwitch.request({ ...h.request, projectPath: join(h.root, 'missing') }, signal), /ENOENT/)
  await assert.rejects(h.manager.projectSwitch.request({ ...h.request, projectPath: import.meta.filename }, signal), /directory/)
  await assert.rejects(h.manager.projectSwitch.request({ ...h.request, threadId: 'stale' }, signal), /current active turn/)
  await h.queue()
  await assert.rejects(h.manager.projectSwitch.request({
    ...h.request, paneId: 'other', threadId: 'other-thread', turnId: 'other-turn'
  }, signal), /already queued/)
  assert.equal(h.switches(), 0)
})

test('interrupt, new message, and shutdown cancel a pending switch', async (t) => {
  for (const operation of ['interrupt', 'send', 'stop'] as const) {
    const h = await fixture(t)
    await h.queue()
    if (operation === 'interrupt') await h.manager.interrupt('source')
    else if (operation === 'send') await h.manager.send('source', 'Changed my mind', [])
    else h.manager.stop()
    assert.equal(h.manager.projectSwitch.state()?.status, 'cancelled')
    await delay(120)
    assert.equal(h.switches(), 0)
  }
})

test('explicit cancellation is caller-scoped; a changed source thread cancels rather than resumes', async (t) => {
  const h = await fixture(t)
  await h.queue()
  h.manager.projectSwitch.cancel('Not the owner', 'other')
  assert.equal(h.manager.projectSwitch.state()?.status, 'pending')
  h.surfaces.get('source')!.state.threadId = 'replacement'
  await until(() => h.manager.projectSwitch.state()?.status === 'cancelled')
  assert.equal(h.switches(), 0)
})

test('blocks new sends during transition and sends the continuation exactly once', async (t) => {
  const h = await fixture(t)
  const release = h.holdSwitch()
  await h.queue()
  h.finish('source')
  h.finish('other')
  await until(() => h.manager.projectSwitch.state()?.status === 'switching')
  try {
    await assert.rejects(h.manager.send('source', 'racing send', []), /in progress/)
    await assert.rejects(h.manager.selectProject(h.root), /in progress/)
  } finally { release() }
  await until(() => h.manager.projectSwitch.state()?.status === 'completed')
  assert.equal(h.switches(), 1)
})

test('a failed switch keeps source panes and exposes the error without retrying', async (t) => {
  const h = await fixture(t)
  h.failSwitch()
  await h.queue()
  h.finish('source')
  h.finish('other')
  await until(() => h.manager.projectSwitch.state()?.status === 'failed')
  assert.match(h.manager.projectSwitch.state()!.error!, /Settings write failed/)
  assert.equal(h.manager.snapshot().workspace?.cwd, h.root)
  assert.ok(h.manager.paneSnapshot('source'))
  assert.ok(!h.surfaces.get('source')!.calls.includes('stop'))
  await delay(150)
  assert.equal(h.switches(), 1)
})

test('a continuation send failure reports the destination so it can be recovered without switching again', async (t) => {
  const h = await fixture(t)
  h.failSend()
  await h.queue()
  h.finish('source')
  h.finish('other')
  await until(() => h.manager.projectSwitch.state()?.status === 'failed')
  assert.equal(h.manager.snapshot().workspace?.cwd, h.destination)
  assert.match(h.manager.projectSwitch.state()!.error!, /Provider could not start/)
  assert.ok(h.store.require(h.manager.projectSwitch.state()!.destinationPaneId!).continuation)
  assert.equal(h.switches(), 1)
})
