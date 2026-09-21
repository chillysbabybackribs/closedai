import assert from 'node:assert/strict'
import test from 'node:test'

import { nullableString, recordOf, recordOfOrEmpty, stringOf } from './json-coerce.js'
import {
  WITHHELD_TOOL_OUTPUT,
  closedAiToolItem,
  jsonPreview,
  promoteCaptureToScreenshot,
  recordableToolOutput,
  toolResultWithheld
} from './tool-transcript-shared.js'

test('json-coerce helpers normalize unknown values', () => {
  assert.deepEqual(recordOf({ a: 1 }), { a: 1 })
  assert.equal(recordOf([]), null)
  assert.deepEqual(recordOfOrEmpty(null), {})
  assert.equal(stringOf(3), '')
  assert.equal(stringOf('ok'), 'ok')
  assert.equal(nullableString(undefined), null)
})

test('closedAiToolItem labels registry tools consistently', () => {
  assert.deepEqual(closedAiToolItem('id-1', 'turn-1', 'embedded_browser', 'page', { url: 'https://example.com' }), {
    type: 'tool',
    id: 'id-1',
    turnId: 'turn-1',
    label: 'embedded_browser · page',
    detail: jsonPreview({ url: 'https://example.com' }),
    status: 'inProgress'
  })
})

test('a credential read keeps a placeholder in its row; every other result and any failure is kept as is', () => {
  assert.equal(toolResultWithheld('credential_vault', 'read'), true)
  assert.equal(toolResultWithheld('credential_vault', 'list'), false)
  assert.equal(toolResultWithheld('embedded_browser', 'page'), false)
  const secret = '{"values":{"password":"hunter2"}}'
  assert.equal(recordableToolOutput('credential_vault · read', secret, false), WITHHELD_TOOL_OUTPUT)
  assert.equal(recordableToolOutput('credential_vault · read', 'Credential field not found: token', true), 'Credential field not found: token')
  assert.equal(recordableToolOutput('credential_vault · read', '', false), '')
  assert.equal(recordableToolOutput('credential_vault · list', '{"credentials":[]}', false), '{"credentials":[]}')
  assert.equal(recordableToolOutput('Read file', secret, false), secret)
})

test('promoteCaptureToScreenshot requires a valid capture surface and image', () => {
  assert.equal(promoteCaptureToScreenshot({
    itemId: 'tool-1',
    turnId: 'turn-1',
    failed: false,
    namespace: 'closedai_ui',
    tool: 'capture',
    action: 'browser_page',
    caption: 'Captured the page',
    imageUrl: 'data:image/png;base64,AAA'
  })?.type, 'screenshot')
  assert.equal(promoteCaptureToScreenshot({
    itemId: 'tool-1',
    turnId: 'turn-1',
    failed: false,
    namespace: 'embedded_browser',
    tool: 'page',
    action: 'browser_page',
    caption: 'nope',
    imageUrl: 'data:image/png;base64,AAA'
  }), null)
})
