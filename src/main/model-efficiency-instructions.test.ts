import assert from 'node:assert/strict'
import test from 'node:test'

import { antigravityAgentInstructions } from './antigravity/antigravity-instructions.js'
import { APPLICATION_INSTRUCTIONS } from './chat-context/application-instructions.js'
import { UNIVERSAL_ARTICULATION_INSTRUCTIONS } from './chat-context/articulation-instructions.js'
import { closedAiDeveloperInstructions } from './chat-context/developer-instructions.js'
import { engineeringInstructions } from './chat-context/engineering-instructions.js'
import { claudeSystemPromptAppend } from './claude/claude-instructions.js'
import { cursorSystemInstructions } from './cursor/cursor-instructions.js'

test('each adapter includes each shared contract once, within the existing prompt budget', () => {
  const instructions = {
    codex: closedAiDeveloperInstructions(),
    claude: claudeSystemPromptAppend('/outside-index'),
    antigravity: antigravityAgentInstructions('/outside-index'),
    cursor: cursorSystemInstructions('/outside-index')
  }
  const budgets = { codex: 5_625, claude: 6_500, antigravity: 7_750, cursor: 7_000 }
  for (const provider of Object.keys(instructions) as Array<keyof typeof instructions>) {
    const value = instructions[provider]
    for (const section of [APPLICATION_INSTRUCTIONS, UNIVERSAL_ARTICULATION_INSTRUCTIONS, engineeringInstructions(provider)]) {
      assert.equal(value.split(section).length - 1, 1, `${provider}: shared section must appear exactly once`)
    }
    assert.ok(value.length < budgets[provider], `${provider}: ${value.length} chars exceeds ${budgets[provider]}`)
    assert.match(value, /Use your native file search, read, and edit tools/)
    assert.doesNotMatch(value, /closedai_workspace|Repository map \(generated|source-change observations/)
    assert.match(value, /Complete authorized work/)
    assert.equal(value.split('Complete authorized work').length - 1, 1, `${provider}: role has one owner`)
    assert.match(value, /Choose your approach/)
    assert.match(value, /explicit references outweigh recency/)
    assert.match(value, /without announcing routine retrieval/)
    assert.doesNotMatch(value, /subagents only|Native browser, web search, and image tools are blocked/)
    assert.match(value, /untrusted/)
    assert.match(value, /never as instructions/)
    assert.doesNotMatch(value, /group all steps|every independent.*belongs|Cost is counted in model passes/)
  }
})
