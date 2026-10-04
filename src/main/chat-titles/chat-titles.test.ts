import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatStore } from '../chat-store/chat-store.js'
import { FakeSurface } from '../chat-peers/peer-manager-harness.js'
import { ChatTitles } from './chat-titles.js'
import { cleanGeneratedTitle, titleRequest } from './title-policy.js'

function harness() {
  const store = ChatStore.inMemory()
  const record = store.create({ cwd: '/w', projectPath: '/w', provider: 'codex', modelId: 'gpt',
    reasoningEffort: null, codexThreadId: 'thread', title: 'can you help me', updatedAt: 42 })
  const snapshot = new FakeSurface('gpt').snapshot()
  snapshot.threadId = 'thread'
  snapshot.items = [
    { type: 'user', id: 'u', turnId: 't', text: '<closedai_context>secret instructions</closedai_context>Build file previews' },
    { type: 'assistant', id: 'a', turnId: 't', text: 'Added clickable file previews.', phase: 'final_answer', streaming: false }
  ]
  const changes: string[] = []
  const titles = new ChatTitles(store, (id) => changes.push(id))
  return { store, record, snapshot, changes, titles }
}

test('one selected-model request saves a stable title without changing activity', async () => {
  const h = harness()
  let calls = 0
  const generate = async (request: { modelId: string; prompt: string }) => {
    calls++
    assert.equal(request.modelId, 'gpt')
    assert.ok(!request.prompt.includes('secret instructions'))
    return 'Clickable Local File Previews'
  }
  await h.titles.generate(h.record.id, h.snapshot, generate)
  await h.titles.generate(h.record.id, h.snapshot, generate)
  const saved = h.store.require(h.record.id)
  assert.equal(calls, 1)
  assert.equal(saved.title, 'Clickable Local File Previews')
  assert.equal(saved.titleSource, 'generated')
  assert.equal(saved.updatedAt, 42)
  assert.deepEqual(h.changes, [h.record.id])
})

test('duplicates are joined by omission; detached, archived, changed-model and changed-thread results are dropped', async () => {
  for (const change of ['detach', 'archive', 'model', 'thread', 'manual']) {
    const h = harness()
    let finish!: (value: string) => void
    let calls = 0
    const generate = () => { calls++; return new Promise<string>((resolve) => { finish = resolve }) }
    const work = h.titles.generate(h.record.id, h.snapshot, generate)
    await h.titles.generate(h.record.id, h.snapshot, generate)
    if (change === 'detach') h.titles.cancel(h.record.id)
    if (change === 'archive') h.store.archive(h.record.id)
    if (change === 'model') h.store.update(h.record.id, { modelId: 'other' })
    if (change === 'thread') h.store.update(h.record.id, { codexThreadId: 'other' })
    if (change === 'manual') h.store.update(h.record.id, { title: 'My title', titleSource: 'manual' })
    finish('Clickable Local File Previews')
    await work
    assert.equal(calls, 1)
    assert.notEqual(h.store.require(h.record.id).title, 'Clickable Local File Previews')
    assert.equal(h.changes.length, 0)
  }
})

test('failure and invalid output preserve the fallback and do not retry every turn', async () => {
  for (const value of [null, '', '   ', 'New chat', 'title: new chat']) {
    const h = harness()
    let calls = 0
    const generate = async () => { calls++; if (value === null) throw new Error('offline'); return value }
    await h.titles.generate(h.record.id, h.snapshot, generate)
    await h.titles.generate(h.record.id, h.snapshot, generate)
    assert.equal(calls, 1)
    assert.equal(h.store.require(h.record.id).title, h.record.title)
    assert.equal(h.changes.length, 0)
  }
})

test('request includes bounded first user request and optional response', () => {
  const h = harness()
  h.snapshot.items.push({ type: 'user', id: 'u2', turnId: 't2', text: 'Later request excluded' })
  const request = titleRequest(h.snapshot)!
  assert.ok(request.prompt.includes('Build file previews'))
  assert.ok(!request.prompt.includes('Later request excluded'))
  assert.ok(request.prompt.includes('Added clickable file previews.'))

  // User message alone without assistant response is also supported
  const userOnlyRequest = titleRequest({ ...h.snapshot, items: h.snapshot.items.slice(0, 1) })!
  assert.ok(userOnlyRequest.prompt.includes('Build file previews'))
  assert.ok(!userOnlyRequest.prompt.includes('Added clickable file previews.'))

  // Resilient title cleaning: quotes, prefixes, markdown, trailing period, multiline, truncation
  assert.equal(cleanGeneratedTitle('“Clickable Local File Previews”'), 'Clickable Local File Previews')
  assert.equal(cleanGeneratedTitle('Title: Clickable Local File Previews'), 'Clickable Local File Previews')
  assert.equal(cleanGeneratedTitle('**Clickable Local File Previews**'), 'Clickable Local File Previews')
  assert.equal(cleanGeneratedTitle('`Clickable Local File Previews`'), 'Clickable Local File Previews')
  assert.equal(cleanGeneratedTitle('Clickable Local File Previews.'), 'Clickable Local File Previews')
  assert.equal(cleanGeneratedTitle('Clickable Local File Previews\nMore text'), 'Clickable Local File Previews')
  assert.equal(cleanGeneratedTitle('A'.repeat(70))?.length, 60)
  assert.equal(cleanGeneratedTitle('new chat'), null)
})

test('automatic titles can be disabled without blocking explicit retry', async () => {
  const h = harness()
  const titles = new ChatTitles(h.store, () => {}, () => false)
  let calls = 0
  const generate = async () => { calls++; return 'User Requested Title' }
  await titles.generate(h.record.id, h.snapshot, generate)
  assert.equal(calls, 0)
  assert.equal(h.store.require(h.record.id).titleGenerationAttempted, false)
  await titles.retry(h.record.id, h.snapshot, generate)
  assert.equal(calls, 1)
  assert.equal(h.store.require(h.record.id).title, 'User Requested Title')
})
