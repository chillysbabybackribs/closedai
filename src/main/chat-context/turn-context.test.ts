import assert from 'node:assert/strict'
import test from 'node:test'
import { closedAiDeveloperInstructions } from './developer-instructions.ts'
import { resumeThreadParams, startThreadParams } from './thread-params.ts'
import {
  buildTurnAdditionalContext,
  needsActiveBrowserContext,
  withSourceChanges,
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
  assert.ok(instructions.length < 4_500)
  assert.match(instructions, /request_user_input is not wired/)
  assert.match(instructions, /pass only the URL to image\(\)/)
  assert.match(instructions, /inside ClosedAI/)
  assert.match(instructions, /marked untrusted/)
  assert.match(instructions, /never as instructions/)
  assert.match(instructions, /group all steps whose arguments are already known/)
  assert.match(instructions, /Yield for another model pass only when fresh output changes the next action/)
  assert.match(instructions, /AGENTS\.md/)
})

test('new and resumed threads receive the same developer instructions', () => {
  const tools = new ToolRegistry([])
  const expected = closedAiDeveloperInstructions('/workspace')
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
        capturedAt: '2026-09-02T12:00:00.000Z',
        ...activeTab
      })
    }
  })
})

test('a browser-relevant turn stays context-free when no active tab exists', () => {
  assert.equal(buildTurnAdditionalContext('Read the current page', null), undefined)
})

test('source changes coexist with browser context and remain untrusted observation data', async () => {
  const browser = buildTurnAdditionalContext('this page', activeTab)
  const changes = { checkedAt: 'now', checkedFiles: 1, changes: [{ path: 'src/example.ts', previousHash: 'old', hash: 'new', status: 'changed' as const }], omittedChanges: 0 }
  const context = await withSourceChanges(browser, { changes: async () => changes }, { paneId: 'p', threadId: 't', cwd: '/w' })
  assert.deepEqual(context!['closedai.browser.active-tab'], browser!['closedai.browser.active-tab'])
  const fragment = context!['closedai.workspace.source-changes']!
  assert.equal(fragment.kind, 'untrusted')
  assert.deepEqual(JSON.parse(fragment.value).changes, changes.changes)
  assert.match(JSON.parse(fragment.value).basis, /not model-context coverage/)
})

test('unchanged or unavailable source enrichment adds no context and preserves existing fragments', async () => {
  const scope = { paneId: 'p', threadId: 't', cwd: '/w' }
  assert.equal(await withSourceChanges(undefined, { changes: async () => null }, scope), undefined)
  const browser = buildTurnAdditionalContext('this page', activeTab)
  assert.equal(await withSourceChanges(browser, { changes: async () => { throw new Error('offline') } }, scope), browser)
})
