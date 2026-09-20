import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ChatContextUsage, ChatTurnContextReport } from '../shared/chat.js'
import {
  calculateTokenBudget,
  formatPercent,
  formatTokens,
  getContextPressureAdvisory
} from './context-budget.ts'
import {
  ContextAdvisoryBanner,
  ContextBudgetSection,
  ContextPressureBadge
} from './context-budget-view.tsx'
import { ContextInspectorModal, ContextReport, EmptyInspector } from './context-inspector-modal.tsx'

function createSampleReport(overrides?: Partial<ChatTurnContextReport>): ChatTurnContextReport {
  return {
    createdAt: Date.now(),
    provider: 'antigravity',
    model: 'claude-3-7-sonnet',
    threadId: 'thread-1',
    message: {
      value: 'Please refactor the component',
      characters: 30,
      estimatedTokens: 1000
    },
    attachments: [],
    additions: [
      {
        name: 'system-context',
        kind: 'application',
        value: 'context payload',
        characters: 16000,
        estimatedTokens: 4000
      }
    ],
    estimatedAddedTextTokens: 5000,
    retainedHistory: 'Full context preserved across turns.',
    ...overrides
  }
}

test('formatTokens formats numbers into human readable token counts', () => {
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(450), '450')
  assert.equal(formatTokens(1200), '1.2k')
  assert.equal(formatTokens(50000), '50.0k')
  assert.equal(formatTokens(128000), '128k')
  assert.equal(formatTokens(1500000), '1.5M')
  assert.equal(formatTokens(12000000), '12M')
})

test('formatPercent formats numbers cleanly', () => {
  assert.equal(formatPercent(0), '0%')
  assert.equal(formatPercent(4.2), '4.2%')
  assert.equal(formatPercent(50), '50%')
  assert.equal(formatPercent(75.8), '76%')
})

test('calculateTokenBudget computes proportional segments under cool usage', () => {
  const report = createSampleReport()
  const usage: ChatContextUsage = {
    usedTokens: 25000,
    contextWindow: 100000,
    percent: 25
  }

  const budget = calculateTokenBudget({ report, usage })
  assert.equal(budget.contextWindow, 100000)
  assert.equal(budget.usedTokens, 25000)
  assert.equal(budget.usedPercent, 25)
  assert.equal(budget.pressureLevel, 'cool')
  assert.equal(budget.messageTokens, 1000)
  assert.equal(budget.additionsTokens, 4000)
  assert.equal(budget.retainedTokens, 20000)
  assert.equal(budget.headroomTokens, 75000)

  // Verify segments
  const retained = budget.segments.find((s) => s.id === 'retained')
  const additions = budget.segments.find((s) => s.id === 'additions')
  const message = budget.segments.find((s) => s.id === 'message')
  const headroom = budget.segments.find((s) => s.id === 'headroom')

  assert.ok(retained && additions && message && headroom)
  assert.equal(retained.percent, 20)
  assert.equal(additions.percent, 4)
  assert.equal(message.percent, 1)
  assert.equal(headroom.percent, 75)
  assert.equal(retained.percent + additions.percent + message.percent + headroom.percent, 100)

  // Cool usage should not trigger an advisory
  assert.equal(getContextPressureAdvisory(budget), null)
})

test('calculateTokenBudget flags warm pressure (50-74%) and suggests compaction', () => {
  const report = createSampleReport()
  const usage: ChatContextUsage = {
    usedTokens: 60000,
    contextWindow: 100000,
    percent: 60
  }

  const budget = calculateTokenBudget({ report, usage })
  assert.equal(budget.pressureLevel, 'warm')
  assert.equal(budget.headroomTokens, 40000)

  const advisory = getContextPressureAdvisory(budget)
  assert.ok(advisory)
  assert.equal(advisory.level, 'warm')
  assert.match(advisory.title, /Moderate context pressure \(60% used\)/)
  assert.equal(advisory.recommendation, 'compact')
})

test('calculateTokenBudget flags hot pressure (>=75%) and suggests compact and new chat', () => {
  const report = createSampleReport()
  const usage: ChatContextUsage = {
    usedTokens: 82000,
    contextWindow: 100000,
    percent: 82
  }

  const budget = calculateTokenBudget({ report, usage })
  assert.equal(budget.pressureLevel, 'hot')
  assert.equal(budget.headroomTokens, 18000)

  const advisory = getContextPressureAdvisory(budget)
  assert.ok(advisory)
  assert.equal(advisory.level, 'hot')
  assert.match(advisory.title, /High context pressure \(82% used\)/)
  assert.equal(advisory.recommendation, 'both')
})

test('calculateTokenBudget handles unmetered / provider managed context gracefully', () => {
  const report = createSampleReport()
  const budget = calculateTokenBudget({ report, usage: null })

  assert.equal(budget.contextWindow, null)
  assert.equal(budget.pressureLevel, 'unmetered')
  assert.equal(budget.usedTokens, 5000)
  assert.equal(budget.segments.length, 2)
  assert.equal(getContextPressureAdvisory(budget), null)
})

test('calculateTokenBudget handles null report and null usage gracefully', () => {
  const budget = calculateTokenBudget({ report: null, usage: null })
  assert.equal(budget.contextWindow, null)
  assert.equal(budget.usedTokens, 0)
  assert.equal(budget.pressureLevel, 'unmetered')
})

test('ContextPressureBadge renders appropriate classes and text', () => {
  const coolBudget = calculateTokenBudget({
    report: createSampleReport(),
    usage: { usedTokens: 20000, contextWindow: 100000, percent: 20 }
  })
  const coolHtml = renderToStaticMarkup(createElement(ContextPressureBadge, { budget: coolBudget }))
  assert.match(coolHtml, /context-pressure-cool/)
  assert.match(coolHtml, /Cool · 20%/)

  const warmBudget = calculateTokenBudget({
    report: createSampleReport(),
    usage: { usedTokens: 55000, contextWindow: 100000, percent: 55 }
  })
  const warmHtml = renderToStaticMarkup(createElement(ContextPressureBadge, { budget: warmBudget }))
  assert.match(warmHtml, /context-pressure-warm/)
  assert.match(warmHtml, /Warm · 55%/)

  const hotBudget = calculateTokenBudget({
    report: createSampleReport(),
    usage: { usedTokens: 85000, contextWindow: 100000, percent: 85 }
  })
  const hotHtml = renderToStaticMarkup(createElement(ContextPressureBadge, { budget: hotBudget }))
  assert.match(hotHtml, /context-pressure-hot/)
  assert.match(hotHtml, /Hot · 85%/)

  const unmeteredBudget = calculateTokenBudget({ report: null, usage: null })
  const unmeteredHtml = renderToStaticMarkup(createElement(ContextPressureBadge, { budget: unmeteredBudget }))
  assert.match(unmeteredHtml, /context-pressure-unmetered/)
  assert.match(unmeteredHtml, /Provider managed/)
})

test('ContextBudgetSection renders progressbar, segments and legend', () => {
  const budget = calculateTokenBudget({
    report: createSampleReport(),
    usage: { usedTokens: 30000, contextWindow: 100000, percent: 30 }
  })
  const html = renderToStaticMarkup(createElement(ContextBudgetSection, { budget }))

  assert.match(html, /role="progressbar"/)
  assert.match(html, /aria-valuenow="30"/)
  assert.match(html, /segment-retained/)
  assert.match(html, /segment-additions/)
  assert.match(html, /segment-message/)
  assert.match(html, /context-budget-legend/)
  assert.match(html, /Retained history/)
  assert.match(html, /Available headroom/)
})

test('ContextAdvisoryBanner renders warning actions and data-ui controls', () => {
  const advisory = {
    level: 'hot' as const,
    title: 'High context pressure (80% used)',
    description: 'Conversation context is nearing the limit.',
    recommendation: 'both' as const
  }

  const html = renderToStaticMarkup(
    createElement(ContextAdvisoryBanner, {
      advisory,
      onCompact: () => {},
      compactEnabled: true,
      onNewChat: () => {}
    })
  )

  assert.match(html, /context-advisory-hot/)
  assert.match(html, /data-ui="context\.compact"/)
  assert.match(html, /data-ui="context\.new-chat"/)
  assert.match(html, /Compact conversation/)
  assert.match(html, /Start fresh chat/)
})

test('ContextInspectorModal renders nothing when closed', () => {
  const html = renderToStaticMarkup(
    createElement(ContextInspectorModal, {
      open: false,
      onOpenChange: () => {},
      report: null,
      usage: null,
      checkpoint: null
    })
  )
  assert.equal(html, '')
})

test('EmptyInspector renders empty state explanation', () => {
  const html = renderToStaticMarkup(createElement(EmptyInspector))
  assert.match(html, /context-inspector-no-report/)
  assert.match(html, /Send a message to capture its turn context/)
})

test('ContextReport renders budget section, advisory banner, and metrics', () => {
  const report = createSampleReport()
  const usage: ChatContextUsage = {
    usedTokens: 78000,
    contextWindow: 100000,
    percent: 78
  }
  const budget = calculateTokenBudget({ report, usage })

  const html = renderToStaticMarkup(
    createElement(ContextReport, {
      report,
      usage,
      checkpoint: null,
      budget,
      onCompact: () => {},
      compactEnabled: true,
      onNewChat: () => {}
    })
  )

  assert.match(html, /context-budget-section/)
  assert.match(html, /Token budget &amp; distribution/)
  assert.match(html, /context-advisory-hot/)
  assert.match(html, /High context pressure \(78% used\)/)
  assert.match(html, /data-ui="context\.compact"/)
  assert.match(html, /data-ui="context\.new-chat"/)
  assert.match(html, /Compact conversation/)
  assert.match(html, /Start fresh chat/)
  assert.match(html, /Added text/)
  assert.match(html, /Retained window/)
  assert.match(html, /ClosedAI additions/)
})
