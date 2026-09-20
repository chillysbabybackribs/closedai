import assert from 'node:assert/strict'
import test from 'node:test'
import { claudeSystemPromptAppend } from './claude-instructions.ts'

test('the append names both conflicts with the claude_code preset', () => {
  const text = claudeSystemPromptAppend('/outside-index')
  // Literal-request scope: the preset forbids widening; ClosedAI asks for objective-bounded widening.
  assert.match(text, /best-known instance of what they are after, not as the boundary/)
  assert.match(text, /overrides the preset’s instruction to act only on the literal request/)
  assert.match(text, /within that objective, is the requested scope/)
  // Bash preference in bypass-permissions mode.
  assert.match(text, /overrides the preset preference for Bash/)
})

test('the objective override follows the shared instruction it qualifies', () => {
  const text = claudeSystemPromptAppend('/outside-index')
  assert.ok(text.indexOf('not as the boundary of the task') < text.indexOf('overrides the preset’s instruction to act only'))
})
