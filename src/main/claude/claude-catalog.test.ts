import assert from 'node:assert/strict'
import test from 'node:test'
import type { AccountInfo, ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { forgetClaudeCatalog, readClaudeCatalog, rememberClaudeCatalog } from './claude-catalog.ts'

const models = [{ model: 'claude-opus-5', displayName: 'Opus 5' }] as unknown as ModelInfo[]
const account = { email: 'someone@example.com' } as AccountInfo

test('a signed-in catalog is shared until it goes stale', () => {
  forgetClaudeCatalog()
  rememberClaudeCatalog('/workspace', { models, account }, 1_000)

  assert.equal(readClaudeCatalog('/workspace', 2_000)?.models.length, 1)
  assert.equal(readClaudeCatalog('/other', 2_000), null)
  assert.equal(readClaudeCatalog('/workspace', 1_000 + 11 * 60 * 1000), null)
  // The stale entry is dropped rather than re-checked on every later pane.
  assert.equal(readClaudeCatalog('/workspace', 2_000), null)
})

test('a signed-out read is never cached, so signing in takes effect on the next pane', () => {
  forgetClaudeCatalog()
  rememberClaudeCatalog('/workspace', { models, account: null })

  assert.equal(readClaudeCatalog('/workspace'), null)
})
