import assert from 'node:assert/strict'
import test from 'node:test'
import type { CredentialSummary } from '../../../shared/credentials.js'
import { ToolRegistry, type ToolCallTrace } from '../registry.js'
import { credentialVaultTools, type CredentialVaultHost } from './index.js'

const credentials: CredentialSummary[] = [
  {
    id: 'login-1',
    serviceId: 'login',
    serviceName: 'Login',
    label: 'Example admin',
    createdAt: 1,
    updatedAt: 2,
    encrypted: true,
    fields: [
      { id: 'url', label: 'Website or service URL', kind: 'url', preview: 'https://example.com', hasValue: true },
      { id: 'username', label: 'Username or email', kind: 'username', preview: 'admin@example.com', hasValue: true },
      { id: 'password', label: 'Password', kind: 'secret', preview: '••••••••', hasValue: true }
    ]
  }
]

function harness(): { registry: ToolRegistry; traces: ToolCallTrace[] } {
  const host: CredentialVaultHost = {
    list: async () => credentials,
    reveal: async (_credentialId, fieldId) => fieldId === 'password' ? 'super-secret' : 'admin@example.com'
  }
  const registry = new ToolRegistry([credentialVaultTools(() => host)])
  const traces: ToolCallTrace[] = []
  registry.observe((trace) => traces.push(trace))
  return { registry, traces }
}

const context = { paneId: 'pane-1', threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', source: 'model' as const }

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
