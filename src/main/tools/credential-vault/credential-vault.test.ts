import assert from 'node:assert/strict'
import test from 'node:test'
import type { CredentialSummary } from '../../../shared/credentials.js'
import type { CredentialApprovalRequest } from '../../../shared/security.js'
import { CredentialApprovalBroker } from '../../security-approvals.js'
import { ToolRegistry, type ToolCallTrace } from '../registry.js'
import { credentialVaultTools, type CredentialAccessPolicy, type CredentialVaultHost } from './index.js'

const credentials: CredentialSummary[] = [
  {
    id: 'login-1',
    serviceId: 'login',
    serviceName: 'Login',
    label: 'Example admin',
    createdAt: 1,
    updatedAt: 2,
    encrypted: true,
    agentAccess: true,
    fields: [
      { id: 'url', label: 'Website or service URL', kind: 'url', preview: 'https://example.com', hasValue: true },
      { id: 'username', label: 'Username or email', kind: 'username', preview: 'admin@example.com', hasValue: true },
      { id: 'password', label: 'Password', kind: 'secret', preview: '••••••••', hasValue: true }
    ]
  }
]

function harness(
  options: { list?: CredentialSummary[]; policy?: CredentialAccessPolicy } = {}
): { registry: ToolRegistry; traces: ToolCallTrace[] } {
  const host: CredentialVaultHost = {
    list: async () => options.list ?? credentials,
    reveal: async (_credentialId, fieldId) => fieldId === 'password' ? 'super-secret' : 'admin@example.com'
  }
  const registry = new ToolRegistry([credentialVaultTools(() => host, () => options.policy ?? null)])
  const traces: ToolCallTrace[] = []
  registry.observe((trace) => traces.push(trace))
  return { registry, traces }
}

const context = { paneId: 'pane-1', threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', source: 'model' as const }
const readArgs = { credential_id: 'login-1', field_ids: ['password'], reason: 'Sign in as requested.' }

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content[0]?.type === 'text' ? result.content[0].text ?? '' : ''
}

test('models can discover masked credentials without decrypting secrets', async () => {
  const { registry } = harness()
  const result = await registry.call(
    { namespace: 'credential_vault', tool: 'list', arguments: { query: 'admin' } },
    context
  )
  const text = result.content[0].type === 'text' ? result.content[0].text : ''
  assert.match(text, /Example admin/)
  assert.match(text, /••••••••/)
  assert.doesNotMatch(text, /super-secret/)
})

test('models can read selected fields while the turn trace redacts the result', async () => {
  const { registry, traces } = harness()
  const result = await registry.call(
    {
      namespace: 'credential_vault',
      tool: 'read',
      arguments: { credential_id: 'login-1', field_ids: ['username', 'password'], reason: 'Sign in as requested.' }
    },
    context
  )
  const text = result.content[0].type === 'text' ? result.content[0].text : ''
  assert.match(text, /admin@example.com/)
  assert.match(text, /super-secret/)

  const traceText = JSON.stringify(traces)
  assert.match(traceText, /sensitive credential result redacted/)
  assert.doesNotMatch(traceText, /super-secret/)
})

test('sensitive reads cannot be aggregated by tool_batch', async () => {
  const { registry } = harness()
  const result = await registry.call(
    {
      namespace: 'credential_vault',
      tool: 'read',
      arguments: { credential_id: 'login-1', field_ids: ['password'], reason: 'Sign in as requested.' }
    },
    { ...context, source: 'batch' }
  )
  assert.equal(result.isError, true)
  assert.match(result.content[0].type === 'text' ? result.content[0].text : '', /cannot run inside tool_batch/)
})

test('list shows the per-entry agent switch and read refuses an entry the user switched off', async () => {
  const { registry } = harness({ list: [{ ...credentials[0]!, agentAccess: false }] })
  const listed = await registry.call({ namespace: 'credential_vault', tool: 'list', arguments: {} }, context)
  assert.match(textOf(listed), /"agentAccess": false/)
  const result = await registry.call({ namespace: 'credential_vault', tool: 'read', arguments: readArgs }, context)
  assert.equal(result.isError, true)
  assert.equal(textOf(result), 'credential_vault.read: The user has not allowed agents to use this credential. Ask them to enable it in Settings → Security.')
  assert.doesNotMatch(textOf(result), /super-secret/)
})

test('with approval required, a declined card refuses the read and the card carried the pane and reason', async () => {
  const broker = new CredentialApprovalBroker(10_000)
  const seen: CredentialApprovalRequest[][] = []
  broker.onChange((pending) => seen.push(pending))
  const policy: CredentialAccessPolicy = { requireApproval: () => true, approve: (request, signal) => broker.ask(request, signal) }
  const { registry } = harness({ policy })
  const call = registry.call({ namespace: 'credential_vault', tool: 'read', arguments: readArgs }, context)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const card = broker.pending()[0]
  assert.ok(card)
  assert.deepEqual(
    { paneId: card.paneId, credentialId: card.credentialId, label: card.credentialLabel, service: card.serviceName, fieldIds: card.fieldIds, reason: card.reason },
    { paneId: 'pane-1', credentialId: 'login-1', label: 'Example admin', service: 'Login', fieldIds: ['password'], reason: 'Sign in as requested.' }
  )
  broker.resolve(card.id, 'deny')
  const result = await call
  assert.equal(result.isError, true)
  assert.equal(textOf(result), 'credential_vault.read: The user declined to share this credential')
  assert.deepEqual(seen.map((pending) => pending.length), [1, 0])
})

test('with approval required, an allowed card returns the values and an unanswered one times out as a refusal', async () => {
  const broker = new CredentialApprovalBroker(10_000)
  const policy: CredentialAccessPolicy = { requireApproval: () => true, approve: (request, signal) => broker.ask(request, signal) }
  const { registry } = harness({ policy })
  const call = registry.call({ namespace: 'credential_vault', tool: 'read', arguments: readArgs }, context)
  await new Promise((resolve) => setTimeout(resolve, 0))
  broker.resolve(broker.pending()[0]!.id, 'allow')
  assert.match(textOf(await call), /super-secret/)

  const slow = new CredentialApprovalBroker(5)
  const timed = harness({ policy: { requireApproval: () => true, approve: (request, signal) => slow.ask(request, signal) } })
  const result = await timed.registry.call({ namespace: 'credential_vault', tool: 'read', arguments: readArgs }, context)
  assert.equal(result.isError, true)
  assert.equal(textOf(result), 'credential_vault.read: The user declined to share this credential')
})

test('with approval off, read never consults the broker', async () => {
  let asked = 0
  const policy: CredentialAccessPolicy = { requireApproval: () => false, approve: async () => { asked += 1; return false } }
  const { registry } = harness({ policy })
  const result = await registry.call({ namespace: 'credential_vault', tool: 'read', arguments: readArgs }, context)
  assert.match(textOf(result), /super-secret/)
  assert.equal(asked, 0)
})
