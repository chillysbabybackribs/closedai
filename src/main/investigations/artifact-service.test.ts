import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { ArtifactService } from './artifact-service.js'
import { ArtifactStore } from './artifact-store.js'
import { cdpTools } from '../tools/cdp/index.js'
import { investigationTools } from '../tools/investigation/index.js'
import { ToolRegistry } from '../tools/registry.js'
import type { CdpToolHost } from '../tools/cdp/host.js'
import type { ToolContext, ToolResult } from '../tools/tool.js'

const context: ToolContext = { paneId: 'chat-a', threadId: 'thread-a', turnId: 'turn-a', callId: 'c1', signal: new AbortController().signal }
const payload = (result: ToolResult) => JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}')

test('registered tools retain untruncated protocol JSON, page it, retry without execution and delete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-artifact-tools-'))
  const store = new ArtifactStore(join(root, 'db'), { workerUrl: new URL('./artifact-worker.ts', import.meta.url) })
  let calls = 0
  const service = new ArtifactService(store, (caller) => {
    if (!caller.paneId) throw new Error('No caller')
    return { chatId: caller.paneId, workspace: '/project' }
  })
  const raw = { result: { prefix: 'x'.repeat(90_000), tail: 'preserved' } }
  const cdp = { command: async () => { calls++; return raw } } as unknown as CdpToolHost
  const registry = new ToolRegistry([cdpTools(() => cdp, service), investigationTools(service)])
  const call = (namespace: string, tool: string, args: Record<string, unknown>, caller = context) => registry.call(
    { namespace, tool, arguments: args }, caller
  )
  try {
    const args = { action: 'command', method: 'DOMSnapshot.captureSnapshot', tab_id: 'tab-a', params: { computedStyles: [] }, retain: true, operation_key: 'snapshot', label: 'snapshot' }
    const receipt = payload(await call('browser_cdp', 'protocol', args))
    assert.equal(receipt.artifact.byteLength > 90_000, true)
    assert.equal(JSON.stringify(receipt).length < 2000, true)
    const id = receipt.artifact.id
    const read = payload(await call('investigation', 'read', { action: 'read', id, pointer: '/result/tail' }))
    assert.equal(JSON.parse(read.data), 'preserved')
    assert.equal(payload(await call('browser_cdp', 'protocol', args)).artifact.id, id)
    assert.equal(calls, 1)
    assert.equal((await call('browser_cdp', 'protocol', { ...args, method: 'Page.navigate' })).isError, true)
    assert.equal(calls, 1)
    assert.equal((await call('investigation', 'read', { action: 'read', id }, { ...context, paneId: 'other' })).isError, true)
    assert.equal((await call('investigation', 'read', { action: 'read', id, scope: 'other' })).isError, true)
    const deleted = payload(await call('investigation', 'manage', { action: 'delete', id }))
    assert.equal(deleted.deleted, true)
    assert.equal((await call('browser_cdp', 'protocol', args)).isError, true)
    assert.equal(calls, 1)
    assert.equal((await call('browser_cdp', 'protocol', { ...args, operation_key: 'missing-tab', tab_id: undefined })).isError, true)
    assert.equal(calls, 1)
    const file = join(root, 'data.json')
    await writeFile(file, '{"value":1}')
    const imported = payload(await call('investigation', 'manage', { action: 'import', path: file, operation_key: 'file', label: 'file', media_type: 'application/json' }))
    assert.equal(imported.artifact.byteLength, 11)
  } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
})

test('failed acquisition keeps an uncertain receipt and changed owner cannot publish', async () => {
  const root = await mkdtemp(join(tmpdir(), 'closedai-artifact-uncertain-'))
  const store = new ArtifactStore(join(root, 'db'), { workerUrl: new URL('./artifact-worker.ts', import.meta.url) })
  let workspace = '/first'
  const service = new ArtifactService(store, () => ({ chatId: 'chat', workspace }))
  const input = { key: 'uncertain', label: 'result', tabId: 'tab', method: 'Runtime.evaluate', params: { expression: '1' } }
  let executed = 0
  try {
    const collect = async () => { executed++; throw new Error('Transport interrupted') }
    await assert.rejects(service.retainProtocol(context, input, collect), /Transport interrupted/)
    await assert.rejects(service.retainProtocol(context, input, collect), /uncertain/)
    assert.equal(executed, 1)
    await assert.rejects(service.retainProtocol(context, { ...input, key: 'changed' }, async () => { workspace = '/second'; return {} }), /caller changed/)
    assert.deepEqual((await service.access(context, 'list', {}) as { artifacts: unknown[] }).artifacts, [])
  } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
})
