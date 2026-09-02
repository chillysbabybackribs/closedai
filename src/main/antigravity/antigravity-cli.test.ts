import assert from 'node:assert/strict'
import test from 'node:test'
import { antigravityChatArgs, antigravityTurnLine, isAntigravityAuthFailure } from './antigravity-cli.js'
import { antigravityConversationIdOf, antigravityModelFamily, antigravityModelId, antigravityThreadId, isAntigravityId } from './antigravity-ids.js'
import { chatProviderOfId } from '../../shared/chat-providers.js'

test('chat argv uses the empty --print value, stream-json both ways, and the workspace as the first --add-dir', () => {
  const args = antigravityChatArgs({
    workspace: '/w',
    model: 'gemini-3.8-flash-high',
    resume: 'conv-1',
    agent: { name: 'closedai', root: '/state/profile' }
  })
  assert.equal(args[0], '--print=')
  assert.ok(args.includes('--dangerously-skip-permissions'))
  assert.ok(args.includes('--disable-slash-commands'))
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'gemini-3.8-flash-high'])
  assert.deepEqual(args.slice(args.indexOf('--conversation'), args.indexOf('--conversation') + 2), ['--conversation', 'conv-1'])
  assert.deepEqual(args.slice(args.indexOf('--agent'), args.indexOf('--agent') + 2), ['--agent', 'closedai'])
  const dirs = args.flatMap((arg, index) => (arg === '--add-dir' ? [args[index + 1]] : []))
  assert.deepEqual(dirs, ['/w', '/state/profile'])
})

test('a fresh conversation without an agent sends neither flag', () => {
  const args = antigravityChatArgs({ workspace: '/w', model: null, resume: null, agent: null })
  assert.ok(!args.includes('--model') && !args.includes('--conversation') && !args.includes('--agent'))
  assert.deepEqual(args.slice(-2), ['--add-dir', '/w'])
})

test('a turn line is the user event the CLI accepts', () => {
  assert.equal(antigravityTurnLine('hi'), '{"event":"user","message":{"role":"user","content":"hi"}}\n')
})

test('ids round-trip through the agy prefix and route to the provider', () => {
  assert.equal(antigravityModelId('gemini-3.8-flash'), 'agy:gemini-3.8-flash')
  assert.equal(antigravityModelFamily('agy:gemini-3.8-flash'), 'gemini-3.8-flash')
  assert.equal(antigravityModelFamily('claude:opus'), null)
  assert.equal(antigravityConversationIdOf(antigravityThreadId('c1')), 'c1')
  assert.equal(isAntigravityId('agy:'), false)
  assert.equal(chatProviderOfId('agy:c1'), 'antigravity')
  assert.equal(chatProviderOfId('claude:s1'), 'claude')
  assert.equal(chatProviderOfId('gpt-5.6-sol'), 'codex')
})

test('auth failures are recognised from the CLI text', () => {
  assert.equal(isAntigravityAuthFailure('Authentication required. Run agy to log in.'), true)
  assert.equal(isAntigravityAuthFailure('connection refused'), false)
})
