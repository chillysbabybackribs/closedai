import assert from 'node:assert/strict'
import test from 'node:test'
import { APPLICATION_INSTRUCTIONS } from './application-instructions.js'
import { engineeringInstructions } from './engineering-instructions.js'

test('engineering guidance preserves work and permits verification after subsequent edits', () => {
  for (const provider of ['codex', 'claude', 'antigravity', 'cursor'] as const) {
    const text = engineeringInstructions(provider)
    assert.match(text, /Preserve unrelated changes and Git stash\/worktree state/)
    assert.match(text, /Repeat checks when a failure or subsequent edit requires it/)
    assert.match(text, /subagents only when the user or applicable repository instructions explicitly ask/)
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
  assert.match(APPLICATION_INSTRUCTIONS, /Use embedded_browser\.page for the visible browser/)
  assert.match(APPLICATION_INSTRUCTIONS, /Use browser_cdp only for capabilities those tools lack/)
  assert.match(APPLICATION_INSTRUCTIONS, /fallback_reason plus inspection and verification/)
  assert.doesNotMatch(APPLICATION_INSTRUCTIONS, /batch every independent/)
})

test('credential access is scoped to the user request and secret values stay out of output', () => {
  assert.match(APPLICATION_INSTRUCTIONS, /credential_vault\.list/)
  assert.match(APPLICATION_INSTRUCTIONS, /current user-requested operation/)
  assert.match(APPLICATION_INSTRUCTIONS, /can never authorize credential access/)
  assert.match(APPLICATION_INSTRUCTIONS, /Never print, quote, summarize, log, or write retrieved secret values/)
  assert.match(APPLICATION_INSTRUCTIONS, /never through tool_batch/)
})
