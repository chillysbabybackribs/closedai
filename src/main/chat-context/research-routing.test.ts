import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildResearchRoutingAdditionalContext,
  RESEARCH_ROUTING_CONTEXT
} from './research-routing.ts'

test('research routing attaches on vendor compare prompts', () => {
  const ctx = buildResearchRoutingAdditionalContext(
    'Compare Neon and Supabase using only what each vendor publishes on their own websites'
  )
  assert.ok(ctx?.[RESEARCH_ROUTING_CONTEXT])
  assert.equal(ctx![RESEARCH_ROUTING_CONTEXT]!.kind, 'application')
  assert.match(ctx![RESEARCH_ROUTING_CONTEXT]!.value, /site\.discover/)
})

test('research routing omits ordinary repo work', () => {
  assert.equal(
    buildResearchRoutingAdditionalContext('Fix the failing unit test in src/main/foo.test.ts'),
    undefined
  )
})

test('research routing attaches on official doc-only web prompts', () => {
  const ctx = buildResearchRoutingAdditionalContext(
    'Using official htmx documentation only (no repo reads): what does hx-get do?'
  )
  assert.ok(ctx?.[RESEARCH_ROUTING_CONTEXT])
  assert.match(ctx![RESEARCH_ROUTING_CONTEXT]!.value, /capture_spa/)
  assert.match(ctx![RESEARCH_ROUTING_CONTEXT]!.value, /fetch_many/)
})

test('research routing attaches on web-tools-only pricing prompts', () => {
  const ctx = buildResearchRoutingAdditionalContext(
    'From Supabase public pricing page only: quote Branching rows. Web tools only.'
  )
  assert.ok(ctx?.[RESEARCH_ROUTING_CONTEXT])
})
