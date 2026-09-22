import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatContinuation } from '../../shared/types.js'
import { chatRecord, FakeSurface } from './peer-manager-harness.js'
import { continuePeer, type ContinuationHost } from './peer-continuation.js'

// "Continue in new chat" against a recorded host: what the digest says about the source and
// where the new chat opens, independent of the manager's attach/select/wake choreography.

type Created = { model: string | null; effort: string | null; continuation: ChatContinuation; selection?: { cwd: string; projectPath: string | null } }

function host(options: { source: FakeSurface; current?: FakeSurface; attached?: boolean; cwd?: string; projectPath?: string | null }) {
  const created: Created[] = []
  const record = chatRecord('source', options.source.state.selectedModel, {
    cwd: options.cwd ?? '/repos/parser', projectPath: options.projectPath === undefined ? '/repos/parser' : options.projectPath
  })
  const current = options.current ?? options.source
  const api: ContinuationHost = {
    current: () => current.snapshot(),
    attached: (paneId) => paneId === 'source' && (options.attached ?? true),
    snapshot: async () => options.source.snapshot(),
    record: (paneId) => paneId === 'source' ? record : undefined,
    readThread: (threadId) => current.readThread(threadId),
    create: async (model, effort, continuation, selection) => {
      created.push({ model, effort, continuation, ...(selection ? { selection } : {}) })
      return 'created'
    }
  }
  return { api, created }
}

test('the new chat opens in the source chat’s directory and its digest says where the work stood', async () => {
  const source = new FakeSurface('gpt-5')
  source.state.cwd = '/repos/parser'
  source.state.threadId = 'thread-source'
  source.state.items = [
    { type: 'user', id: 'u1', turnId: 't1', text: 'Refactor the parser' },
    { type: 'assistant', id: 'a1', turnId: 't1', text: 'Parser refactored.', phase: 'final_answer', streaming: false },
    { type: 'user', id: 'u2', turnId: 't2', text: 'Now add tests' }
  ]
  // The focused chat lives elsewhere; a continuation must not land the work there.
  const focused = new FakeSurface('claude:opus')
  focused.state.cwd = '/elsewhere'
  const { api, created } = host({ source, current: focused, projectPath: null })

  const paneId = await continuePeer(api, { paneId: 'source', threadId: null }, null)

  assert.equal(paneId, 'created')
  assert.equal(created.length, 1)
  const [made] = created
  assert.deepEqual(made!.selection, { cwd: '/repos/parser', projectPath: null })
  // Without an explicit model the continuation stays on the source chat's model, not the focused one.
  assert.equal(made!.model, 'gpt-5')
  assert.equal(made!.continuation.sourcePaneId, 'source')
  assert.equal(made!.continuation.sourceThreadId, 'thread-source')
  assert.equal(made!.continuation.sourceThroughItemId, 'u2')
  assert.match(made!.continuation.handoff ?? '', /Working directory there: \/repos\/parser/)
  assert.match(made!.continuation.handoff ?? '', /2 user requests; the latest request had no completed answer/)
})

test('a detached source is digested from its record and thread without a live snapshot', async () => {
  const source = new FakeSurface('gpt-5')
  const reader = new FakeSurface('gpt-5')
  const { api, created } = host({ source, current: reader, attached: false, cwd: '/saved/dir' })

  await continuePeer(api, { paneId: 'source', threadId: 'saved-thread' }, 'claude:opus')

  assert.deepEqual(reader.calls, ['read:saved-thread'])
  assert.equal(created[0]!.model, 'claude:opus')
  assert.deepEqual(created[0]!.selection, { cwd: '/saved/dir', projectPath: '/repos/parser' })
  assert.match(created[0]!.continuation.handoff ?? '', /Working directory there: \/saved\/dir/)
  assert.match(created[0]!.continuation.handoff ?? '', /1 user request; the latest request was answered/)
})

test('a history-only source without a record leaves the directory to the focused chat', async () => {
  const reader = new FakeSurface('gpt-5')
  const { api, created } = host({ source: reader, attached: false })

  await continuePeer(api, { paneId: null, threadId: 'saved-thread' }, null)

  assert.equal(created[0]!.selection, undefined)
  assert.doesNotMatch(created[0]!.continuation.handoff ?? '', /Working directory there/)
})

test('a running source is refused before anything is created', async () => {
  const source = new FakeSurface('gpt-5')
  source.state.activeTurnId = 'turn-1'
  source.state.items = [{ type: 'user', id: 'u1', turnId: 'turn-1', text: 'Working' }]
  const { api, created } = host({ source })

  await assert.rejects(continuePeer(api, { paneId: 'source', threadId: null }, null), /Stop the current turn/)
  assert.equal(created.length, 0)
})
