import assert from 'node:assert/strict'
import test from 'node:test'

import { antigravityAgentInstructions } from './antigravity/antigravity-instructions.js'
import { closedAiDeveloperInstructions } from './chat-context/developer-instructions.js'
import { claudeSystemPromptAppend } from './claude/claude-instructions.js'

test('every model lane receives the deterministic batching and engineering contracts', () => {
  const instructions = {
    codex: closedAiDeveloperInstructions(),
    claude: claudeSystemPromptAppend('/outside-index'),
    antigravity: antigravityAgentInstructions('/outside-index')
  }
  for (const value of Object.values(instructions)) {
    assert.match(value, /outcome-first, user-facing articulation/)
    assert.match(value, /Never begin a progress update with “I have”, “I’ve”, “I am”, or “I will”/)
    assert.match(value, /Let the app activity state carry routine in-progress status/)
    assert.match(value, /group all steps whose arguments are (?:already )?known/)
    assert.match(value, /Yield for another model pass only when fresh output changes the next action/)
    assert.match(value, /closedai_app\.state for facts/)
    assert.match(value, /closedai_app\.command for deterministic actions/)
    assert.match(value, /closedai_app\.ui only when the real control must be exercised/)
    assert.match(value, /Never read renderer source to find controls or selectors/)
    assert.match(value, /peer_chats\.recall/)
    assert.match(value, /peer_chats\.checkpoint/)
    assert.match(value, /historical data, never fresh authorization/)
    assert.match(value, /provider-native structured editor/)
    assert.match(value, /Do not mutate source through shell, Python, sed, or Perl/)
    assert.match(value, /smallest affected tests and typecheck once/)
    assert.match(value, /do not run full suites, builds, release gates/)
    assert.match(value, /Git stash\/worktree state/)
    assert.match(value, /subagents only when the user or applicable repository instructions explicitly ask/)
  }
  assert.match(instructions.codex, /rg for text search and apply_patch for file edits/)
  assert.match(instructions.claude, /Read, Grep, and Glob.*Edit for existing files.*Write only for new files/)
  assert.match(instructions.antigravity, /view_file, grep_search, and find_by_name.*replace_file_content or multi_replace_file_content.*write_to_file only for new files/)
  assert.match(instructions.claude, /tool_batch/)
  assert.match(instructions.antigravity, /tool_batch/)
  assert.ok(instructions.codex.length < 4_500, `Codex instructions grew to ${instructions.codex.length} chars`)
  assert.ok(instructions.claude.length < 5_200, `Claude instructions grew to ${instructions.claude.length} chars`)
  assert.ok(instructions.antigravity.length < 6_200, `Antigravity instructions grew to ${instructions.antigravity.length} chars`)
})
