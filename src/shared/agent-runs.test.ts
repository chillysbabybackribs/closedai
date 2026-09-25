import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRunExcerpt } from './agent-runs.js'

test('run excerpts flatten markdown but keep identifiers intact', () => {
  assert.equal(agentRunExcerpt('closedai_app.ui: input must run inside tool_batch.run'),
    'closedai_app.ui: input must run inside tool_batch.run')
  assert.equal(agentRunExcerpt('## Done\n- **Fixed** the _flaky_ `test_one` __run__'), 'Done Fixed the flaky test_one run')
  assert.equal(agentRunExcerpt('```\ncode\n```'), null)
  assert.equal(agentRunExcerpt('abcdefghij', 5), 'abcd…')
})
