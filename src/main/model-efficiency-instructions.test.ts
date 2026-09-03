import assert from 'node:assert/strict'
import test from 'node:test'

import { antigravityAgentInstructions } from './antigravity/antigravity-instructions.js'
import { closedAiDeveloperInstructions } from './chat-context/developer-instructions.js'
import { claudeSystemPromptAppend } from './claude/claude-instructions.js'

test('every model lane receives the deterministic batching contract', () => {
  const instructions = [
    closedAiDeveloperInstructions(),
    claudeSystemPromptAppend('/outside-index'),
    antigravityAgentInstructions('/outside-index')
  ]
  for (const value of instructions) {
    assert.match(value, /group all steps whose arguments are (?:already )?known/)
    assert.match(value, /Yield for another model pass only when fresh output changes the next action/)
    assert.match(value, /closedai_app\.state for facts/)
    assert.match(value, /closedai_app\.command for deterministic actions/)
    assert.match(value, /closedai_app\.ui only when the real control must be exercised/)
    assert.match(value, /Never read renderer source to find controls or selectors/)
  }
  assert.match(instructions[1]!, /tool_batch/)
  assert.match(instructions[2]!, /tool_batch/)
})
