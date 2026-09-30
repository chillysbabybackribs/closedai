import assert from 'node:assert/strict'
import test from 'node:test'

import { parseToolSliceCatalog } from '../../shared/tool-slices.ts'
import { needsActiveBrowserContext } from '../chat-context/turn-context.ts'
import { needsResearchToolSlice, selectToolSliceId } from './tool-slice-select.ts'

const catalog = parseToolSliceCatalog({
  version: 1,
  codexEagerWireCap: 3600,
  slices: {
    core: { label: 'Core', description: 'x', promotePriority: [] },
    browser: { label: 'Browser', description: 'x', promotePriority: [] },
    research: { label: 'Research', description: 'x', promotePriority: [] }
  },
  signals: {
    browser: { slice: 'browser' },
    research: { slice: 'research' },
    default: { slice: 'core' }
  }
})

test('browser slice wins on browser phrasing or a live non-blank tab', () => {
  assert.equal(selectToolSliceId(catalog, { prompt: 'Read the current page', surface: null }), 'browser')
  assert.ok(needsActiveBrowserContext('Read the current page'))
  assert.equal(
    selectToolSliceId(catalog, { prompt: 'Fix the unit test', surface: { tabId: 't', url: 'https://example.com', title: 'Ex', isLoading: false } }),
    'browser'
  )
  assert.equal(
    selectToolSliceId(catalog, { prompt: 'Fix the unit test', surface: { tabId: 't', url: 'about:blank', title: '', isLoading: false } }),
    'core'
  )
})

test('research slice triggers on web research phrasing but not repo work', () => {
  assert.ok(needsResearchToolSlice({ prompt: 'Research the latest news on vector databases', surface: null }))
  assert.equal(selectToolSliceId(catalog, { prompt: 'Research the latest news on vector databases', surface: null }), 'research')
  assert.ok(needsResearchToolSlice({
    prompt: 'Compare Neon and Supabase using only what each vendor publishes on their own websites',
    surface: null
  }))
  assert.ok(!needsResearchToolSlice({ prompt: 'Search the codebase for ToolRegistry', surface: null }))
  assert.equal(selectToolSliceId(catalog, { prompt: 'Search the codebase for ToolRegistry', surface: null }), 'core')
})

test('browser intent outranks research cues in the same message', () => {
  assert.equal(
    selectToolSliceId(catalog, { prompt: 'Research this page in the browser tab', surface: null }),
    'browser'
  )
})
