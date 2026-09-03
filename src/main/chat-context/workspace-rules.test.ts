import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { antigravityAgentInstructions } from '../antigravity/antigravity-instructions.ts'
import { claudeSystemPromptAppend } from '../claude/claude-instructions.ts'
import { MAX_WORKSPACE_RULE_CHARS, workspaceRulesSection } from './workspace-rules.ts'

test('Claude and Antigravity receive the selected workspace root AGENTS policy', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-workspace-rules-'))
  try {
    await writeFile(join(dir, 'AGENTS.md'), '# Project rules\n\nUse the structured editor.\n')
    const section = workspaceRulesSection(dir)
    assert.match(section ?? '', /developer-authorized project policy/)
    assert.match(section ?? '', /Use the structured editor/)
    assert.ok(claudeSystemPromptAppend(dir).includes(section!))
    assert.ok(antigravityAgentInstructions(dir).includes(section!))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('missing, empty, and oversized root policies are handled without an unbounded prompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-workspace-rules-'))
  try {
    assert.equal(workspaceRulesSection(dir), null)
    await writeFile(join(dir, 'AGENTS.md'), '   \n')
    assert.equal(workspaceRulesSection(dir), null)
    await writeFile(join(dir, 'AGENTS.md'), 'x'.repeat(MAX_WORKSPACE_RULE_CHARS + 100))
    const section = workspaceRulesSection(dir) ?? ''
    assert.match(section, /ClosedAI clipped this root policy/)
    assert.ok(section.length < MAX_WORKSPACE_RULE_CHARS + 500)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
