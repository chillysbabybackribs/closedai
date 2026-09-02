import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatEvent } from '../shared/chat.js'
import type { AppServerClient, AppServerRequest, RpcId } from './app-server-client.js'
import { ChatApprovals } from './chat-approvals.js'

function harness() {
  const responses: Array<{ id: RpcId; result: unknown }> = []
  const errors: Array<{ id: RpcId; code: number; message: string }> = []
  const events: ChatEvent[] = []
  const client = {
    respond: (id: RpcId, result: unknown) => { responses.push({ id, result }) },
    respondWithError: (id: RpcId, code: number, message: string) => { errors.push({ id, code, message }) }
  } as unknown as AppServerClient
  return { approvals: new ChatApprovals(client, (event) => events.push(event)), responses, errors, events }
}

test('routes an app-server command approval and returns its decision', () => {
  const { approvals, responses, events } = harness()
  approvals.handleServerRequest({
    id: 7,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command: 'npm test' }
  })

  assert.deepEqual(approvals.snapshot(), [{
    requestId: '7',
    kind: 'command',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    title: 'Allow command?',
    detail: 'npm test',
    reason: null
  }])
  approvals.respond('7', 'accept')
  assert.deepEqual(responses, [{ id: 7, result: { decision: 'accept' } }])
  assert.deepEqual(events.map((event) => event.type), ['approval', 'approvalResolved'])
})

test('rejects unsupported server requests at the protocol boundary', () => {
  const { approvals, errors } = harness()
  approvals.handleServerRequest({ id: 'unknown', method: 'unknown/request' } as AppServerRequest)
  assert.deepEqual(errors, [{
    id: 'unknown',
    code: -32601,
    message: 'ClosedAI does not support server request unknown/request'
  }])
})
