import assert from 'node:assert/strict'
import test from 'node:test'
import { basename, formatChatTime, historyErrorMessage } from './history-format.ts'

test('basename extracts trailing filename or directory', () => {
  assert.equal(basename('/a/b/c.ts'), 'c.ts')
  assert.equal(basename('/a/b/c/'), 'c')
  assert.equal(basename('file.ts'), 'file.ts')
})

test('basename handles Windows path backslashes and trailing separators', () => {
  assert.equal(basename('C:\\Users\\dp\\project\\file.ts'), 'file.ts')
  assert.equal(basename('C:\\Users\\dp\\project\\'), 'project')
})

test('formatChatTime formats relative intervals', () => {
  const now = 100_000
  assert.equal(formatChatTime(now - 10_000, now), 'Just now')
  assert.equal(formatChatTime(now - 120_000, now), '2m ago')
  assert.equal(formatChatTime(0), '')
})

test('history failures retain actionable text without Electron transport prefixes', () => {
  assert.equal(historyErrorMessage(new Error("Error invoking remote method 'chat:open': Error: Missing thread")), 'Missing thread')
  assert.equal(historyErrorMessage('x'.repeat(200)).length, 140)
})
