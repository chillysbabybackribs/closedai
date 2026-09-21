import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_PROVIDERS } from '../shared/chat-providers.js'
import { PROVIDER_INSTALL_HINTS, PROVIDER_SIGN_IN_HINTS, isMissingExecutable, missingProviderMessage } from './provider-binary.js'

test('a spawn ENOENT is recognised by code, by message, and through the CLI runners\' rephrasing', () => {
  const byCode = Object.assign(new Error('Could not start codex: spawn codex ENOENT'), { code: 'ENOENT' })
  assert.equal(isMissingExecutable(byCode), true)
  assert.equal(isMissingExecutable(new Error('Could not start codex: spawn codex ENOENT')), true)
  assert.equal(isMissingExecutable('spawn cursor-agent ENOENT'), true)
  assert.equal(isMissingExecutable(new Error('The Antigravity CLI (/home/u/.local/bin/agy) was not found. Install it or set CLOSEDAI_ANTIGRAVITY_BIN.')), true)
})

test('other failures are not read as a missing binary', () => {
  assert.equal(isMissingExecutable(new Error('Codex app-server request timed out: initialize')), false)
  assert.equal(isMissingExecutable(new Error('model gpt-x not found')), false)
  assert.equal(isMissingExecutable(Object.assign(new Error('denied'), { code: 'EACCES' })), false)
  assert.equal(isMissingExecutable(null), false)
})

test('every provider has an install sentence and a sign-in sentence, and the Codex one is the onboarding line', () => {
  for (const provider of CHAT_PROVIDERS) {
    assert.ok(PROVIDER_INSTALL_HINTS[provider].length > 20, provider)
    assert.ok(PROVIDER_SIGN_IN_HINTS[provider].length > 20, provider)
  }
  assert.equal(
    missingProviderMessage('codex'),
    'Codex is not installed. Install the Codex CLI and sign in from the app, or choose another model.'
  )
})
