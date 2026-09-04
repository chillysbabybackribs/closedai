import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bareChatId,
  CHAT_PROVIDER_ID_PREFIXES,
  CHAT_PROVIDER_LABELS,
  CHAT_PROVIDER_TURN_PREFIXES,
  CHAT_PROVIDERS,
  chatProviderOfId,
  chatProviderOfTurnId,
  isChatIdOf,
  isChatProvider,
  prefixChatId
} from './chat-providers.ts'

// The registry is what a new provider is added to. These guard the invariants the tables
// carry that a `Record<ChatProvider, string>` cannot: exactly one unprefixed provider, no
// prefix that swallows another, and a label for every entry.

test('exactly one provider owns unprefixed ids, and no prefix is a prefix of another', () => {
  for (const table of [CHAT_PROVIDER_ID_PREFIXES, CHAT_PROVIDER_TURN_PREFIXES]) {
    const prefixes = CHAT_PROVIDERS.map((provider) => table[provider])
    assert.equal(prefixes.filter((prefix) => prefix === '').length, 1)
    const named = prefixes.filter((prefix) => prefix !== '')
    assert.equal(new Set(named).size, named.length)
    for (const prefix of named) {
      assert.equal(named.filter((other) => other !== prefix && other.startsWith(prefix)).length, 0)
    }
  }
})

test('every provider is labelled and recognised as one', () => {
  for (const provider of CHAT_PROVIDERS) {
    assert.ok(CHAT_PROVIDER_LABELS[provider].length > 0)
    assert.ok(isChatProvider(provider))
  }
  assert.equal(isChatProvider('copilot'), false)
  assert.equal(isChatProvider(null), false)
})

test('ids round-trip through their own provider and are rejected by the others', () => {
  for (const provider of CHAT_PROVIDERS) {
    const id = prefixChatId(provider, 'value-1')
    assert.equal(chatProviderOfId(id), provider)
    assert.ok(isChatIdOf(provider, id))
    assert.equal(bareChatId(provider, id), 'value-1')
    for (const other of CHAT_PROVIDERS) {
      if (other === provider) continue
      assert.equal(isChatIdOf(other, id), false)
      assert.equal(bareChatId(other, id), null)
    }
  }
})

test('an unknown or empty id belongs to the unprefixed provider, and nothing routes on a bare prefix', () => {
  assert.equal(chatProviderOfId('thread-uuid'), 'codex')
  assert.equal(chatProviderOfId(null), 'codex')
  assert.equal(chatProviderOfId(CHAT_PROVIDER_ID_PREFIXES.claude), 'codex')
  assert.equal(isChatIdOf('codex', ''), false)
  assert.equal(bareChatId('codex', null), null)
})

test('turn ids route on their own table, not the id table', () => {
  assert.equal(chatProviderOfTurnId(`${CHAT_PROVIDER_TURN_PREFIXES.claude}1`), 'claude')
  assert.equal(chatProviderOfTurnId(`${CHAT_PROVIDER_TURN_PREFIXES.antigravity}1`), 'antigravity')
  assert.equal(chatProviderOfTurnId('turn-1'), 'codex')
  assert.equal(chatProviderOfTurnId(CHAT_PROVIDER_ID_PREFIXES.claude + '1'), 'codex')
})
