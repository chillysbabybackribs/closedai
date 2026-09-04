import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CODEX_EXEC_TOOL_BATCHING_INSTRUCTION,
  DIRECT_CALL_TOOL_BATCHING_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION
} from './product-instructions.js'

test('batching is scoped to steps whose outcome the model does not need to see', () => {
  for (const instruction of [DIRECT_CALL_TOOL_BATCHING_INSTRUCTION, CODEX_EXEC_TOOL_BATCHING_INSTRUCTION]) {
    assert.match(instruction, /whose outcome you do not need to see/)
    // A state change is a decision point, not another step to pre-plan through.
    assert.match(instruction, /arms state on a target[^]*decision point/)
    // The old unscoped wording is what licensed batching a mutation blind.
    assert.doesNotMatch(instruction, /group all steps/)
  }
})

test('a cause must be isolated before it is asserted', () => {
  assert.match(EVIDENCE_CLAIMS_INSTRUCTION, /Do not assert a cause you have not isolated/)
  assert.match(EVIDENCE_CLAIMS_INSTRUCTION, /smallest check that separates the candidates/)
})
