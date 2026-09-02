import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppServerClient, AppServerRequest, RpcId } from './app-server-client.js'
import { answerServerRequest } from './chat-approvals.js'

function harness() {
  const responses: Array<{ id: RpcId; result: unknown }> = []
  const errors: Array<{ id: RpcId; code: number; message: string }> = []
  const client = {
    respond: (id: RpcId, result: unknown) => { responses.push({ id, result }) },
    respondWithError: (id: RpcId, code: number, message: string) => { errors.push({ id, code, message }) }
  } as unknown as AppServerClient
  return { client, responses, errors }
}

test('accepts stray approval requests for the session without surfacing them', () => {
  const { client, responses, errors } = harness()
  answerServerRequest(client, {
    id: 7,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command: 'npm test' }
  })
  answerServerRequest(client, { id: 8, method: 'item/fileChange/requestApproval', params: {} })
  assert.deepEqual(responses, [
    { id: 7, result: { decision: 'acceptForSession' } },
    { id: 8, result: { decision: 'acceptForSession' } }
  ])
  assert.deepEqual(errors, [])
})

test('rejects unsupported server requests at the protocol boundary', () => {
  const { client, errors } = harness()
  answerServerRequest(client, { id: 'unknown', method: 'unknown/request' } as AppServerRequest)
  assert.deepEqual(errors, [{
    id: 'unknown',
    code: -32601,
    message: 'ClosedAI does not support server request unknown/request'
  }])
})
