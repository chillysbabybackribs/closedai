import assert from 'node:assert/strict'
import test from 'node:test'

import type { ChatConnection, ChatProvider } from '../shared/chat.js'
import { CHAT_PROVIDERS } from '../shared/chat-providers.js'
import { probeProviderOnboarding } from './chat-hub-provider-onboarding.js'

function fakeHub(connections: Partial<Record<ChatProvider, ChatConnection>>) {
  return {
    async probeProviderConnection(provider: ChatProvider) {
      const connection = connections[provider] ?? { state: 'signed-out', message: '' }
      return { connection, accountEmail: connection.state === 'ready' ? 'user@example.com' : null }
    }
  }
}

test('probeProviderOnboarding marks missing binaries unavailable', async () => {
  const rows = await probeProviderOnboarding(null)
  assert.equal(rows.length, CHAT_PROVIDERS.length)
  for (const row of rows) {
    assert.ok(row.connection === 'unavailable' || row.connection === 'unknown')
  }
})

test('probeProviderOnboarding reads live connection state from the hub', async () => {
  const hub = fakeHub({
    codex: { state: 'ready', message: '' },
    claude: { state: 'signed-out', message: 'Sign in' }
  })
  const rows = await probeProviderOnboarding(hub as never)
  const codex = rows.find((row) => row.provider === 'codex')
  const claude = rows.find((row) => row.provider === 'claude')
  assert.equal(codex?.connection, 'ready')
  assert.equal(codex?.accountEmail, 'user@example.com')
  assert.equal(claude?.connection, 'signed-out')
})
