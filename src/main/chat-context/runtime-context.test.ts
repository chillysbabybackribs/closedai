import assert from 'node:assert/strict'
import test from 'node:test'
import { setAppCheckoutPath } from '../app-checkout.js'
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
  assert.equal(payload.chatProjectPath, '/project')
  assert.equal(payload.projectPath, '/project')
  assert.equal(payload.appCheckoutPath, null)
  assert.equal(payload.selfDevelopment, false)
  assert.equal(payload.sessionGuideOnTurn, false)
  assert.match(payload.verify, /closedai_app\.state/)
  assert.match(payload.userCollaboration, /hypotheses/)
})

test('every provider receives userCollaboration on runtime', () => {
  for (const provider of ['codex', 'claude', 'antigravity', 'cursor'] as const) {
    const payload = JSON.parse(buildRuntimeAdditionalContext({
      paneId: 'p',
      provider,
      cwd: '/w',
      chatMemoryIndexEnabled: true,
      sessionGuideOnTurn: false
    })[RUNTIME_CONTEXT]!.value)
    assert.match(payload.userCollaboration, /explicit direction/)
  }
})

test('buildRuntimeAdditionalContext marks selfDevelopment when chat folder is the app checkout', () => {
  setAppCheckoutPath('/home/dp/Documents/closedai')
  const context = buildRuntimeAdditionalContext({
    paneId: 'pane-1',
    provider: 'codex',
    cwd: '/home/dp/Documents/closedai',
    chatMemoryIndexEnabled: true,
    sessionGuideOnTurn: false
  })
  const payload = JSON.parse(context[RUNTIME_CONTEXT]!.value)
  assert.equal(payload.appCheckoutPath, '/home/dp/Documents/closedai')
  assert.equal(payload.selfDevelopment, true)
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
    assert.match(payload.developmentFirstRead, /appCheckoutPath/)
    assert.match(payload.developmentFirstRead, /chatProjectPath/)
    assert.match(payload.developmentFirstRead, /before implementation searches or edits/)
    assert.match(payload.developmentFirstRead, /opening guidance and task-relevant sections/)
    assert.match(payload.developmentFirstRead, /project's own instructions/)
    assert.match(payload.developmentFirstRead, /does not apply to unrelated chat, web research, or browser tasks/)
  })
}
