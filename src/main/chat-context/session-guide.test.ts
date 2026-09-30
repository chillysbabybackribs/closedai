import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_GUIDE_TEXT } from './agent-guide.generated.ts'
import {
  agentGuideAdditionalContext,
  buildTurnSendContext,
  markSessionGuideDelivered,
  SESSION_GUIDE_CONTEXT,
  SESSION_GUIDE_MAX_CHARS,
  sessionGuideThreadKey,
  shouldAttachSessionGuide,
  type SessionGuideDeliveryState
} from './session-guide.ts'
import { contextBlockText } from './turn-context.ts'
import { WORKSPACE_LEDGER_CONTEXT } from './workspace-ledger-pilot/constants.ts'

test('generated guide fits the session budget', () => {
  assert.ok(AGENT_GUIDE_TEXT.length > 200)
  assert.ok(AGENT_GUIDE_TEXT.length <= SESSION_GUIDE_MAX_CHARS)
  assert.match(AGENT_GUIDE_TEXT, /Tier 1/)
  assert.match(AGENT_GUIDE_TEXT, /npm run test:one/)
})

test('session guide is application context', () => {
  const ctx = agentGuideAdditionalContext()
  assert.equal(ctx[SESSION_GUIDE_CONTEXT]?.kind, 'application')
  assert.match(contextBlockText(SESSION_GUIDE_CONTEXT, ctx[SESSION_GUIDE_CONTEXT]!), /kind="application"/)
})

test('shouldAttachSessionGuide follows thread and handoff rules', () => {
  const state: SessionGuideDeliveryState = { lastDeliveredThreadKey: null }
  assert.equal(shouldAttachSessionGuide({
    threadKey: 'thread-a',
    state,
    transcriptWasEmpty: true,
    hasHandoff: false
  }), true)
  markSessionGuideDelivered(state, 'thread-a')
  assert.equal(shouldAttachSessionGuide({
    threadKey: 'thread-a',
    state,
    transcriptWasEmpty: true,
    hasHandoff: false
  }), false)
  assert.equal(shouldAttachSessionGuide({
    threadKey: 'thread-b',
    state,
    transcriptWasEmpty: false,
    hasHandoff: true
  }), true)
})

test('unsaved thread key upgrades without a second guide', () => {
  const state: SessionGuideDeliveryState = { lastDeliveredThreadKey: null }
  const unsaved = sessionGuideThreadKey(null, null, 'pane-1')
  assert.match(unsaved, /^unsaved:/)
  assert.equal(shouldAttachSessionGuide({
    threadKey: unsaved,
    state,
    transcriptWasEmpty: true,
    hasHandoff: false
  }), true)
  markSessionGuideDelivered(state, unsaved)
  const live = sessionGuideThreadKey(null, 'live-session', 'pane-1')
  assert.equal(shouldAttachSessionGuide({
    threadKey: live,
    state,
    transcriptWasEmpty: false,
    hasHandoff: false
  }), false)
  markSessionGuideDelivered(state, live)
  assert.equal(state.lastDeliveredThreadKey, 'live-session')
})

test('buildTurnSendContext orders clock before guide and handoff', () => {
  const state: SessionGuideDeliveryState = { lastDeliveredThreadKey: null }
  const { context, attachGuide } = buildTurnSendContext({
    threadKey: 't1',
    state,
    transcriptWasEmpty: true,
    pendingHandoff: 'Handoff digest',
    browserContext: undefined
  })
  assert.equal(attachGuide, true)
  assert.ok(context)
  const keys = Object.keys(context!)
  assert.equal(keys[0], 'closedai.clock')
  assert.equal(keys[1], SESSION_GUIDE_CONTEXT)
  assert.equal(keys[2], 'closedai.chat.handoff')
})

test('buildTurnSendContext places workspace ledger after handoff and before browser', () => {
  const state: SessionGuideDeliveryState = { lastDeliveredThreadKey: 't1' }
  const ledger = {
    [WORKSPACE_LEDGER_CONTEXT]: { kind: 'untrusted' as const, value: '{"fresh":[]}' }
  }
  const browser = {
    'closedai.browser.active-tab': { kind: 'untrusted' as const, value: '{}' }
  }
  const { context } = buildTurnSendContext({
    threadKey: 't1',
    state,
    transcriptWasEmpty: false,
    pendingHandoff: 'digest',
    workspaceLedgerContext: ledger,
    browserContext: browser
  })
  assert.deepEqual(Object.keys(context!), [
    'closedai.clock',
    'closedai.chat.handoff',
    WORKSPACE_LEDGER_CONTEXT,
    'closedai.browser.active-tab'
  ])
})

test('buildTurnSendContext always attaches clock even without guide', () => {
  const state: SessionGuideDeliveryState = { lastDeliveredThreadKey: 't1' }
  const { context, attachGuide } = buildTurnSendContext({
    threadKey: 't1',
    state,
    transcriptWasEmpty: false,
    pendingHandoff: null,
    browserContext: undefined
  })
  assert.equal(attachGuide, false)
  assert.deepEqual(Object.keys(context!), ['closedai.clock'])
})
