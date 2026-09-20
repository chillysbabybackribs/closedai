import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { DEFAULT_APP_SETTINGS } from './app-settings-store.ts'
import type { AppSettings } from '../shared/types.ts'
import type { CodexWorkspaceRuntime } from './codex-workspace-runtime.ts'
import { ToolRegistry } from './tools/registry.ts'
import { dynamicToolSpecs } from './tools/app-server-tools.ts'

// These service tests do not process images; Electron's native module is absent in Node.
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron') return { url: 'data:text/javascript,export const nativeImage = {}', shortCircuit: true }
    return next(specifier, context)
  }
})
const { ChatService } = await import('./chat-service.ts')
hook.deregister()

async function fixture(t: test.TestContext, savedTools: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'closedai-catalog-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'rollout.jsonl')
  await writeFile(path, JSON.stringify({ payload: { dynamic_tools: savedTools } }) + '\n')
  const tools = new ToolRegistry([{
    name: 'probe', description: 'Probe tools', tools: [{
      name: 'read', description: 'Current description', inputSchema: { type: 'object' },
      async execute() { return { content: [{ type: 'text', text: 'ok' }] } }
    }]
  }])
  let saved: AppSettings = { ...DEFAULT_APP_SETTINGS, chatSeamlessRotation: false }
  const settings = {
    get: () => saved,
    async set(patch: Partial<AppSettings>) { saved = { ...saved, ...patch }; return saved },
    checkpoint: () => null,
    sessionRotations: () => saved.chatSessionRotations ?? []
  }
  const requests: Array<{ method: string; params: unknown }> = []
  let failStart = false
  const client = Object.assign(new EventEmitter(), {
    async request(method: string, params: unknown) {
      requests.push({ method, params })
      if (method === 'thread/start') {
        if (failStart) throw new Error('Start failed')
        return { thread: { id: 'new-thread' } }
      }
      return { thread: { id: 'old-thread', path, turns: [{ id: 'old-turn', items: [
        { type: 'userMessage', id: 'old-user', content: [{ type: 'text', text: 'Investigate the page' }] }
      ] }] } }
    }
  })
  const runtime = { session: () => client } as unknown as CodexWorkspaceRuntime
  const service = new ChatService(directory, settings, tools, () => null, null, runtime, 'pane')
  const internal = service as unknown as {
    resumeThread(id: string): Promise<void>
    ensureThread(clientUserMessageId?: string): Promise<string>
    transcript: { addOptimisticUser(id: string, text: string): void }
  }
  return { tools, settings, requests, internal, failStart: (value: boolean) => { failStart = value } }
}

test('unchanged resumed catalogs reuse the thread; changed descriptions rotate with source recall', async (t) => {
  const h = await fixture(t, [])
  const catalog = dynamicToolSpecs(h.tools)
  const same = await fixture(t, catalog)
  await same.internal.resumeThread('old-thread')
  assert.equal(await same.internal.ensureThread(), 'old-thread')
  assert.equal(same.requests.filter((r) => r.method === 'thread/start').length, 0)

  const stale = structuredClone(catalog)
  stale[0]!.tools[0]!.description = 'Retired description'
  const changed = await fixture(t, stale)
  await changed.internal.resumeThread('old-thread')
  changed.internal.transcript.addOptimisticUser('pending', 'New request')
  assert.equal(await changed.internal.ensureThread('pending'), 'new-thread')
  assert.deepEqual((changed.requests.find((r) => r.method === 'thread/start')!.params as Record<string, unknown>).dynamicTools, catalog)
  assert.equal(changed.settings.get().chatContinuation?.sourceThreadId, 'old-thread')
  assert.doesNotMatch(changed.settings.get().chatContinuation!.handoff!, /New request/)
  assert.equal(changed.settings.get().chatSessionRotations?.length, 1)
  assert.equal(await changed.internal.ensureThread(), 'new-thread')
  assert.equal(changed.requests.filter((r) => r.method === 'thread/start').length, 1)
})

test('unknown catalogs refresh, failed starts retain handoff, and disabled tools refresh again', async (t) => {
  const h = await fixture(t, null)
  await h.internal.resumeThread('old-thread')
  h.failStart(true)
  await assert.rejects(h.internal.ensureThread(), /Start failed/)
  assert.equal(h.settings.get().chatContinuation?.sourceThreadId, 'old-thread')
  h.failStart(false)
  await h.internal.ensureThread()
  h.tools.setEnabled('probe.read', false)
  await h.internal.ensureThread()
  const starts = h.requests.filter((r) => r.method === 'thread/start')
  assert.deepEqual((starts.at(-1)!.params as Record<string, unknown>).dynamicTools, [])
  assert.ok(h.requests.filter((r) => r.method === 'thread/resume').every((r) => !('dynamicTools' in (r.params as object))))
})
