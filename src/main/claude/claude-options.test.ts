import assert from 'node:assert/strict'
import test from 'node:test'
import { claudeEffortLevel, claudeQueryOptions } from './claude-options.js'
import { CLAUDE_RUNTIME_ID_ENV } from './claude-process-tree.js'

const base = {
  cwd: '/w',
  model: 'opus[1m]',
  effort: 'xhigh',
  adaptiveThinking: true,
  resume: null,
  runtimeId: '0f7c0c9c-1c1e-4c7a-9f8b-3a1f6d2e9a10',
  mcpServers: {},
  systemPromptAppend: 'Be brief.',
  env: { PATH: '/bin' }
}

test('the session shape: no prompts, isolated settings, only app MCP servers, summarized thinking', () => {
  const options = claudeQueryOptions(base)
  assert.equal(options.permissionMode, 'bypassPermissions')
  assert.equal(options.allowDangerouslySkipPermissions, true)
  assert.deepEqual(options.settingSources, ['project'])
  assert.equal(options.strictMcpConfig, true)
  assert.equal(options.includePartialMessages, true)
  assert.deepEqual(options.disallowedTools, ['AskUserQuestion'])
  assert.deepEqual(options.thinking, { type: 'adaptive', display: 'summarized' })
  assert.deepEqual(options.systemPrompt, { type: 'preset', preset: 'claude_code', append: 'Be brief.' })
  assert.equal(options.model, 'opus[1m]')
  assert.equal(options.effort, 'xhigh')
  assert.equal(options.resume, undefined)
  assert.equal(options.env?.[CLAUDE_RUNTIME_ID_ENV], base.runtimeId)
  assert.equal(options.env?.PATH, '/bin')
  assert.equal(options.env?.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1')
})

test('account default model, no effort, no thinking config, and a resume id', () => {
  const options = claudeQueryOptions({ ...base, model: null, effort: 'ultra', adaptiveThinking: false, resume: 'sess' })
  assert.equal('model' in options, false)
  assert.equal('effort' in options, false)
  assert.equal('thinking' in options, false)
  assert.equal(options.resume, 'sess')
})

test('effort levels are the five the SDK accepts', () => {
  assert.equal(claudeEffortLevel('max'), 'max')
  assert.equal(claudeEffortLevel('ultra'), null)
  assert.equal(claudeEffortLevel(null), null)
})
