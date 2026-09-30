import assert from 'node:assert/strict'
import test from 'node:test'
import { RUNTIME_CONTEXT, buildRuntimeAdditionalContext } from './runtime-context.js'

test('buildRuntimeAdditionalContext emits factual JSON under closedai.runtime', () => {
  const context = buildRuntimeAdditionalContext({
    paneId: 'pane-1',
    provider: 'cursor',
    cwd: '/project',
    chatMemoryIndexEnabled: true,
    sessionGuideOnTurn: false
  })
  assert.equal(context[RUNTIME_CONTEXT]?.kind, 'application')
  const payload = JSON.parse(context[RUNTIME_CONTEXT]!.value)
  assert.equal(payload.host, 'closedai')
  assert.equal(payload.paneId, 'pane-1')
  assert.equal(payload.provider, 'cursor')
  assert.equal(payload.projectPath, '/project')
  assert.equal(payload.sessionGuideOnTurn, false)
  assert.match(payload.verify, /closedai_app\.state/)
})
