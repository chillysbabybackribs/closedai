import assert from 'node:assert/strict'
import test from 'node:test'
import {
  firstLineOfUserMessage,
  isInjectedContextTitle,
  sanitizeThreadTitle,
  stripContextBlocks,
  summarizeUserMessage
} from './chat-display.js'

test('stripContextBlocks removes closedai_context blocks and surrounding whitespace', () => {
  const text = '<closedai_context name="x" kind="application">\nstate\n</closedai_context>\nFix naming'
  assert.equal(stripContextBlocks(text), 'Fix naming')
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
