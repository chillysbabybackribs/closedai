import assert from 'node:assert/strict'
import test from 'node:test'

import { startThreadParams } from './chat-context/thread-params.js'
import { claudeQueryOptions } from './claude/claude-options.js'
import { renderAgent } from './antigravity/antigravity-profile.js'
import { ToolRegistry } from './tools/registry.js'

test('the baseline adds no developer or custom-agent instructions', () => {
  assert.equal('developerInstructions' in startThreadParams('/w', new ToolRegistry([])), false)
  assert.equal(renderAgent('/w').trimEnd().endsWith('---'), true)
  const options = claudeQueryOptions({ cwd: '/w', model: null, effort: null, adaptiveThinking: false,
    resume: null, runtimeId: 'test', mcpServers: {} })
  assert.deepEqual(options.systemPrompt, { type: 'preset', preset: 'claude_code' })
})
