import assert from 'node:assert/strict'
import test from 'node:test'
import {
  firstLineOfUserMessage,
  handoffDigestForDisplay,
  handoffSourceTitle,
  isInjectedContextTitle,
  sanitizeThreadTitle,
  displayUserMessageText,
  stripContextBlocks,
  summarizeUserMessage
} from './chat-display.js'

test('displayUserMessageText removes context blocks and user_query wrappers', () => {
  const raw = [
    '<closedai_context name="closedai.instructions" kind="application">',
    'secret',
    '</closedai_context>',
    '<user_query>Build the MVP</user_query>'
  ].join('\n')
  assert.equal(displayUserMessageText(raw), 'Build the MVP')
})

test('stripContextBlocks removes closedai_context blocks and surrounding whitespace', () => {
  const text = '<closedai_context name="x" kind="application">\nstate\n</closedai_context>\nFix naming'
  assert.equal(stripContextBlocks(text), 'Fix naming')
})

test('stripContextBlocks removes a truncated opening tag with no closer', () => {
  assert.equal(stripContextBlocks('<closedai_context name="closedai.instructi'), '')
})

test('handoffSourceTitle prefers the user request after context markup', () => {
  const wrapped = '<closedai_context name="a">\nrules\n</closedai_context>\nMove continue menu'
  assert.equal(handoffSourceTitle(wrapped), 'Move continue menu')
  assert.equal(handoffSourceTitle('<closedai_context name="x">', 'Real task'), 'Real task')
  assert.equal(handoffSourceTitle(null, null), 'Previous chat')
})

test('handoffDigestForDisplay scrubs legacy stored digests for the card', () => {
  const raw = [
    'Handoff from the previous chat "<closedai_context name=\\"x\\">".',
    '<closedai_context name="y">',
    '</closedai_context>',
    'User: Clean request',
    'Assistant: ok'
  ].join('\n')
  const shown = handoffDigestForDisplay(raw)
  assert.match(shown, /^Handoff from the previous chat "Previous chat"\./)
  assert.match(shown, /User: Clean request/)
})

test('summarizeUserMessage uses the first user line after context blocks', () => {
  const wrapped = '<closedai_context name="a" kind="untrusted">\nx\n</closedai_context>\nWrite a plan\nmore'
  assert.equal(summarizeUserMessage(wrapped), 'Write a plan')
  assert.equal(firstLineOfUserMessage(`${'a'.repeat(90)}`).length, 80)
})

test('sanitizeThreadTitle rejects injected markup titles', () => {
  assert.equal(isInjectedContextTitle('<closedai_context name="closedai.instructions">'), true)
  assert.equal(sanitizeThreadTitle('Sidebar fixes'), 'Sidebar fixes')
  assert.equal(sanitizeThreadTitle('<closedai_context name="x">'), null)
})
