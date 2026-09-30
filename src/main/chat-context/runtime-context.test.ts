import assert from 'node:assert/strict'
import test from 'node:test'
import { RUNTIME_CONTEXT, buildRuntimeAdditionalContext } from './runtime-context.js'

test('buildRuntimeAdditionalContext emits host facts under closedai.runtime', () => {
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

for (const provider of ['codex', 'claude', 'antigravity', 'cursor'] as const) {
  test(`${provider} receives development first-read guidance without a session guide`, () => {
    const context = buildRuntimeAdditionalContext({
      paneId: 'existing-pane',
      provider,
      cwd: '/project',
      chatMemoryIndexEnabled: false,
      sessionGuideOnTurn: false
    })
    const payload = JSON.parse(context[RUNTIME_CONTEXT]!.value)
    assert.match(payload.developmentFirstRead, /first read docs\/application\.md in projectPath/)
    assert.match(payload.developmentFirstRead, /before searching implementation code or making changes/)
    assert.match(payload.developmentFirstRead, /opening guidance and the sections relevant to the task/)
    assert.match(payload.developmentFirstRead, /If the file is absent/)
    assert.match(payload.developmentFirstRead, /does not apply to unrelated chat, web research, or browser tasks/)
  })
}
