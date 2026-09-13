import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CODEX_EXEC_TOOL_BATCHING_INSTRUCTION,
  DIRECT_CALL_TOOL_BATCHING_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION
} from './product-instructions.js'

test('batching permits dependent decisions and requires releasing temporary state', () => {
  for (const instruction of [DIRECT_CALL_TOOL_BATCHING_INSTRUCTION, CODEX_EXEC_TOOL_BATCHING_INSTRUCTION]) {
    assert.match(instruction, /before choosing dependent actions/)
    assert.match(instruction, /release/)
    assert.doesNotMatch(instruction, /group all steps/)
  }
  assert.match(DIRECT_CALL_TOOL_BATCHING_INSTRUCTION, /direct calls are fine/)
  assert.match(CODEX_EXEC_TOOL_BATCHING_INSTRUCTION, /try\/finally/)
})

test('evidence guidance distinguishes hypotheses without prescribing a reasoning sequence', () => {
  assert.match(EVIDENCE_CLAIMS_INSTRUCTION, /observed evidence/)
  assert.match(EVIDENCE_CLAIMS_INSTRUCTION, /Distinguish observations from hypotheses/)
  assert.doesNotMatch(EVIDENCE_CLAIMS_INSTRUCTION, /smallest check|run it/)
})
