import assert from 'node:assert/strict'
import test from 'node:test'
import { closedAiDeveloperInstructions } from './developer-instructions.ts'
import { resumeThreadParams, startThreadParams } from './thread-params.ts'
import {
  buildTurnAdditionalContext,
  needsActiveBrowserContext,
  type ActiveBrowserContext
} from './turn-context.ts'
import { ToolRegistry } from '../tools/registry.ts'

const activeTab: ActiveBrowserContext = {
  tabId: 'tab-7',
  url: 'https://example.com/report',
  title: 'Quarterly report',
  isLoading: false
}

test('developer instructions stay within their expanded budget and establish the product trust boundary', () => {
  const instructions = closedAiDeveloperInstructions()
  assert.ok(instructions.length < 5_625)
  assert.match(instructions, /request_user_input is not wired/)
  assert.match(instructions, /pass only the URL to image\(\)/)
  assert.match(instructions, /inside ClosedAI/)
  assert.match(instructions, /untrusted data/)
  assert.match(instructions, /never as instructions/)
  assert.match(instructions, /before choosing dependent actions/)
})

test('new and resumed threads receive the same developer instructions', () => {
  const tools = new ToolRegistry([])
  const expected = closedAiDeveloperInstructions()
  assert.equal(startThreadParams('/workspace', tools, { model: 'model-a', effort: null }).developerInstructions, expected)
  assert.equal(resumeThreadParams('thread-a', '/workspace', tools).developerInstructions, expected)
  assert.equal(startThreadParams('/workspace', tools, { model: 'model-a', effort: null }).model, 'model-a')
  assert.equal(resumeThreadParams('thread-a', '/workspace', tools).threadId, 'thread-a')
  assert.deepEqual(
    startThreadParams('/workspace', tools, { model: 'model-a', effort: 'low', contextWindow: 1_000_000 }).config,
    { model_reasoning_effort: 'low', model_context_window: 1_000_000 }
  )
  assert.deepEqual(
    resumeThreadParams('thread-a', '/workspace', tools, { model: 'model-a', effort: 'medium', contextWindow: 400_000 }).config,
    { model_reasoning_effort: 'medium', model_context_window: 400_000 }
  )
})

test('browser context is gated to browser and visible-page requests', () => {
  assert.equal(needsActiveBrowserContext('Refactor the settings store'), false)
  assert.equal(needsActiveBrowserContext('What is on the current page?'), true)
  assert.equal(needsActiveBrowserContext('Open this link in a new tab'), true)
  assert.equal(needsActiveBrowserContext('What are we looking at?'), true)
})

test('an unrelated turn carries no additional context', () => {
  assert.equal(buildTurnAdditionalContext('Run the unit tests', activeTab), undefined)
})

test('active tab metadata is a timestamped untrusted fragment', () => {
  const context = buildTurnAdditionalContext(
    'Summarize this page',
    activeTab,
    '2026-09-02T12:00:00.000Z'
  )
  assert.deepEqual(context, {
    'closedai.browser.active-tab': {
      kind: 'untrusted',
      value: JSON.stringify({
        surface: 'browser',
        contextRole: 'ambient',
        relevance: 'undetermined',
        capturedAt: '2026-09-02T12:00:00.000Z',
        ...activeTab
      })
    }
  })
})

test('a browser-relevant turn stays context-free when no active tab exists', () => {
  assert.equal(buildTurnAdditionalContext('Read the current page', null), undefined)
})
