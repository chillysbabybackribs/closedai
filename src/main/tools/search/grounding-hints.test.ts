import assert from 'node:assert/strict'
import test from 'node:test'

import type { ResearchSnapshot } from '../../../shared/web-research.js'
import {
  attachResearchGroundingHint,
  attachSearchGroundingHint,
  researchSnapshotNeedsGroundingHint,
  searchResponseNeedsGroundingHint
} from './grounding-hints.ts'

test('search grounding hint when answers or snippet-only results', () => {
  assert.equal(searchResponseNeedsGroundingHint({ results: [], answers: [{ provider: 'you', text: 'x' }] }), true)
  assert.equal(
    searchResponseNeedsGroundingHint({
      results: [{ title: 't', url: 'https://a.example', snippet: 's', provider: 'brave' }],
      answers: []
    }),
    true
  )
  assert.equal(
    searchResponseNeedsGroundingHint({
      results: [{
        title: 't', url: 'https://a.example', snippet: 's', provider: 'exa',
        content: { text: 'full page', highlights: [], truncated: false }
      }],
      answers: []
    }),
    false
  )
})

test('attachSearchGroundingHint adds hint only when needed', () => {
  const bare = { query: 'q', results: [] as const, answers: [] as const }
  assert.deepEqual(attachSearchGroundingHint(bare, bare), bare)
  const withHint = attachSearchGroundingHint(bare, { ...bare, answers: [{ provider: 'you', text: 'a' }] })
  assert.match(withHint.groundingHint ?? '', /embedded_browser\.session/)
})

test('research snapshot hint when queries completed without retained pages', () => {
  const base: ResearchSnapshot = {
    runId: 'r', state: 'running', cursor: 0, pending: 0, completedQueries: 1, totalQueries: 1,
    sourceCount: 0, omittedSources: 0, omittedErrors: 0, sources: [], errors: [],
    presentation: { state: 'none' }
  }
  assert.equal(researchSnapshotNeedsGroundingHint(base), true)
  const grounded: ResearchSnapshot = {
    ...base,
    sources: [{
      id: 's1', url: 'https://vendor.example/pricing', title: 'Pricing', discoveredBy: ['exa'],
      snippet: '', state: 'ready', revision: 1, representation: 'static_text', chars: 12_000, incomplete: false
    }]
  }
  assert.equal(researchSnapshotNeedsGroundingHint(grounded), false)
  assert.equal(attachResearchGroundingHint(grounded).groundingHint, undefined)
})
