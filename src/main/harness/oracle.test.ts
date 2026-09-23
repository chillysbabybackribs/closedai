import assert from 'node:assert/strict'
import test from 'node:test'
import { scoreOracle } from './oracle.js'
import type { RecordedToolCall } from './types.js'

const readPage: RecordedToolCall = {
  namespace: 'embedded_browser',
  tool: 'page',
  arguments: { action: 'read_page', pdf_page: 2 }
}

test('oracle passes when required calls and limits are satisfied', () => {
  const failures = scoreOracle({
    must_call: [{ ...readPage, partialArgs: true }],
    must_not_call: [{ namespace: 'embedded_browser', tool: 'page', arguments: { action: 'navigate' } }],
    max_tool_calls: 3
  }, [readPage])
  assert.deepEqual(failures, [])
})

test('oracle reports missing and forbidden calls', () => {
  const navigate: RecordedToolCall = {
    namespace: 'embedded_browser',
    tool: 'page',
    arguments: { action: 'navigate' }
  }
  const missing = scoreOracle({ must_call: [readPage] }, [])
  assert.ok(missing.some((f) => f.includes('missing required')))
  const forbidden = scoreOracle({
    must_not_call: [{ namespace: 'embedded_browser', tool: 'page', arguments: { action: 'navigate' } }]
  }, [navigate])
  assert.ok(forbidden.some((f) => f.includes('forbidden')))
})

test('oracle can expect usage failures', () => {
  const failed: RecordedToolCall = { ...readPage, errorKind: 'usage' }
  assert.deepEqual(scoreOracle({ expect_success: true }, [failed]), [
    'call embedded_browser.page failed: usage'
  ])
  assert.deepEqual(scoreOracle({ expect_success: false }, [failed]), [])
})
