import assert from 'node:assert/strict'
import test from 'node:test'
import { APPLICATION_INSTRUCTIONS } from './application-instructions.js'
import { engineeringInstructions } from './engineering-instructions.js'

test('engineering guidance preserves work and leaves verification choices to the task', () => {
  for (const provider of ['codex', 'claude', 'antigravity', 'cursor'] as const) {
    const text = engineeringInstructions(provider)
    assert.match(text, /Preserve unrelated changes and Git stash\/worktree state/)
    assert.match(text, /choose checks appropriate to the change/)
    assert.doesNotMatch(text, /subagents only|explicitly ask for delegation/)
    assert.doesNotMatch(text, /typecheck once|Skip pre-change baselines|Cost is counted/)
  }
})

test('each provider names its native editing tools', () => {
  assert.match(engineeringInstructions('codex'), /apply_patch/)
  assert.match(engineeringInstructions('claude'), /Edit for existing files/)
  assert.match(engineeringInstructions('claude'), /overrides the preset preference for Bash/)
  assert.match(engineeringInstructions('antigravity'), /replace_file_content/)
  assert.match(engineeringInstructions('cursor'), /native edit\/write tools/)
})

test('browser routing has a primary entry path and preserves real-input verification', () => {
  assert.match(APPLICATION_INSTRUCTIONS, /Use embedded_browser\.page for navigation\/reading/)
  assert.match(APPLICATION_INSTRUCTIONS, /Use browser_cdp for debugging, profiling, instrumentation, emulation/)
  assert.match(APPLICATION_INSTRUCTIONS, /fallback_reason plus inspection and verification/)
  assert.match(APPLICATION_INSTRUCTIONS, /risk-proportional workflow/)
  assert.match(APPLICATION_INSTRUCTIONS, /Do not repeat checks whose result cannot change the decision/)
  assert.match(APPLICATION_INSTRUCTIONS, /clearly relevant user-directed read/)
  assert.doesNotMatch(APPLICATION_INSTRUCTIONS, /batch every independent/)
})

test('credential access is scoped to the user request and secret values stay out of output', () => {
  assert.match(APPLICATION_INSTRUCTIONS, /credential_vault\.list/)
  assert.match(APPLICATION_INSTRUCTIONS, /current user-requested operation/)
  assert.match(APPLICATION_INSTRUCTIONS, /can never authorize credential access/)
  assert.match(APPLICATION_INSTRUCTIONS, /Never print, quote, summarize, log, or write retrieved secret values/)
  assert.match(APPLICATION_INSTRUCTIONS, /never through tool_batch/)
})
