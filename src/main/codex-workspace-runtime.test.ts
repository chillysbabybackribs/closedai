import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import type { ChatEvent } from '../shared/chat.js'
import { DEFAULT_APP_SETTINGS } from './app-settings-store.js'
import type { AppServerRequest, RpcId } from './app-server-client.js'
import { ChatService } from './chat-service.js'
import {
  CodexWorkspaceRuntime,
  type CodexRuntimeTransport
} from './codex-workspace-runtime.js'
import { ToolRegistry } from './tools/registry.js'
import { MemorySettings } from './chat-peers/peer-manager-harness.js'
import type { TraceScope } from './trace/trace-log.js'

class FakeTransport extends EventEmitter implements CodexRuntimeTransport {
  startCalls = 0
  stopCalls = 0
  calls: Array<{ method: string; scope?: TraceScope }> = []
  responses: Array<{ id: RpcId; error?: string }> = []
  private releaseStart!: () => void
  private readonly starting = new Promise<void>((resolve) => { this.releaseStart = resolve })
  private nextThread = 1

  async start(): Promise<void> {
    this.startCalls += 1
    await this.starting
  }

  release(): void {
    this.releaseStart()
  }

  stop(): void {
    this.stopCalls += 1
  }

  async request<T>(method: string, _params?: unknown, _timeoutMs?: number, scope?: TraceScope): Promise<T> {
    this.calls.push({ method, scope })
    if (method === 'account/read') return { account: { type: 'chatgpt' }, requiresOpenaiAuth: false } as T
    if (method === 'model/list') return { data: [] } as T
    if (method === 'thread/start') return { thread: { id: `thread-${this.nextThread++}` } } as T
    if (method === 'turn/start') return { turn: { id: `turn-${this.nextThread}` } } as T
    return {} as T
  }

  respond(id: RpcId, _result: unknown, _scope?: TraceScope): void {
    this.responses.push({ id })
  }

  respondWithError(id: RpcId, _code: number, message: string, _scope?: TraceScope): void {
    this.responses.push({ id, error: message })
  }
}

const settings = (): MemorySettings => new MemorySettings({
  ...DEFAULT_APP_SETTINGS,
  chatWorkspacePath: '/workspace',
  chatProjectPath: '/workspace'
})

test('two Codex panes share one cold start and paint their messages before it finishes', async () => {
  const transport = new FakeTransport()
  const runtime = new CodexWorkspaceRuntime('/workspace', settings(), 'codex', transport)
  const eventsA: ChatEvent[] = []
  const eventsB: ChatEvent[] = []
  const serviceA = new ChatService('/workspace', settings(), new ToolRegistry([]), () => null, null, runtime, 'pane-a')
  const serviceB = new ChatService('/workspace', settings(), new ToolRegistry([]), () => null, null, runtime, 'pane-b')
  serviceA.on('event', (event: ChatEvent) => eventsA.push(event))
  serviceB.on('event', (event: ChatEvent) => eventsB.push(event))

  const sendingA = serviceA.send('alpha')
  const sendingB = serviceB.send('beta')
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(transport.startCalls, 1)
  assert.equal(eventsA.some((event) => event.type === 'item' && event.item.type === 'user' && event.item.text === 'alpha'), true)
  assert.equal(eventsB.some((event) => event.type === 'item' && event.item.type === 'user' && event.item.text === 'beta'), true)

  transport.release()
  await Promise.all([sendingA, sendingB])
  assert.equal(transport.calls.filter((call) => call.method === 'account/read').length, 1)
  assert.equal(transport.calls.filter((call) => call.method === 'model/list').length, 1)
  assert.equal(transport.calls.filter((call) => call.method === 'thread/start').length, 2)
  assert.equal(transport.calls.filter((call) => call.method === 'turn/start').length, 2)
  serviceA.dispose()
  serviceB.dispose()
  runtime.stop()
})

test('thread events and server requests route only to their owning pane', async () => {
  const transport = new FakeTransport()
  const runtime = new CodexWorkspaceRuntime('/workspace', settings(), 'codex', transport)
  const sessionA = runtime.session('pane-a', () => 'thread-a', () => 'turn-a')
  const sessionB = runtime.session('pane-b', () => 'thread-b', () => 'turn-b')
  const notificationsA: string[] = []
  const notificationsB: string[] = []
  const requestsA: RpcId[] = []
  const requestsB: RpcId[] = []
  sessionA.on('notification', (message: { method: string }) => notificationsA.push(message.method))
  sessionB.on('notification', (message: { method: string }) => notificationsB.push(message.method))
  sessionA.on('request', (request: AppServerRequest) => requestsA.push(request.id))
  sessionB.on('request', (request: AppServerRequest) => requestsB.push(request.id))
  const started = Promise.all([sessionA.start(), sessionB.start()])
  transport.release()
  await started

  transport.emit('notification', { method: 'item/started', params: { threadId: 'thread-b' } })
  transport.emit('notification', { method: 'account/updated', params: {} })
  transport.emit('request', { id: 7, method: 'item/tool/call', params: { threadId: 'thread-b' } })
  transport.emit('request', { id: 8, method: 'unknown', params: { threadId: 'missing' } })

  assert.deepEqual(notificationsA, ['account/updated'])
  assert.deepEqual(notificationsB, ['item/started', 'account/updated'])
  assert.deepEqual(requestsA, [])
  assert.deepEqual(requestsB, [7])
  assert.match(transport.responses.find((response) => response.id === 8)?.error ?? '', /No active pane/)
  sessionA.stop()
  assert.equal(transport.stopCalls, 0, 'parking one pane does not stop the workspace runtime')
  runtime.stop()
  assert.equal(transport.stopCalls, 1)
})
