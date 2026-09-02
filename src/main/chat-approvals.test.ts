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
  answerServerRequest(client, { id: 9, method: 'execCommandApproval', params: {} })
  answerServerRequest(client, { id: 10, method: 'applyPatchApproval', params: {} })
  assert.deepEqual(responses, [
    { id: 7, result: { decision: 'acceptForSession' } },
    { id: 8, result: { decision: 'acceptForSession' } },
    { id: 9, result: { decision: 'approved_for_session' } },
    { id: 10, result: { decision: 'approved_for_session' } }
  ])
  assert.deepEqual(errors, [])
})

test('auto-grants permission and user-input requests so turns do not stall on timers', () => {
  const { client, responses } = harness()
  answerServerRequest(client, {
    id: 11,
    method: 'item/permissions/requestApproval',
    params: { permissions: { network: { enabled: true } } }
  })
  answerServerRequest(client, {
    id: 12,
    method: 'item/tool/requestUserInput',
    params: {
      questions: [{
        id: 'q1',
        header: 'Pick',
        question: 'Which?',
        options: [{ label: 'First', description: 'one' }, { label: 'Second', description: 'two' }]
      }]
    }
  })
  answerServerRequest(client, { id: 13, method: 'mcpServer/elicitation/request', params: {} })
  assert.deepEqual(responses, [
    { id: 11, result: { permissions: { network: { enabled: true } }, scope: 'session' } },
    { id: 12, result: { answers: { q1: { answers: ['First'] } } } },
    { id: 13, result: { action: 'decline' } }
  ])
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
