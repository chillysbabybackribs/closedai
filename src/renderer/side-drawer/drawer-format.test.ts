import assert from 'node:assert/strict'
import test from 'node:test'
import { basename, formatChatTime, formatLiveActivity, formatMessageCount } from './drawer-format.ts'

test('formatLiveActivity extracts filenames from tool activities and paths', () => {
  assert.equal(
    formatLiveActivity('Read file', '/home/dp/Desktop/closedai/src/main/browser-network/network-rules.ts'),
    'Read network-rules.ts'
  )
  assert.equal(
    formatLiveActivity('Edit file', '/home/dp/Desktop/closedai/src/main/chat-peers/peer-manager.ts'),
    'Edit peer-manager.ts'
  )
  assert.equal(
    formatLiveActivity('List directory', '/home/dp/Desktop/closedai/src/main/chat-context'),
    'List chat-context'
  )
})

test('formatLiveActivity cleans command snippets', () => {
  assert.equal(
    formatLiveActivity('Run command', 'npm run hygiene'),
    'Run npm run hygiene'
  )
  assert.equal(
    formatLiveActivity('Run command', '/bin/bash -lc "npm test"'),
    'Run npm test'
  )
})

test('formatLiveActivity falls back cleanly when details are missing or plain', () => {
  assert.equal(formatLiveActivity(null), 'Running')
  assert.equal(formatLiveActivity(undefined), 'Running')
  assert.equal(formatLiveActivity('Thinking'), 'Thinking')
  assert.equal(formatLiveActivity('Searching', 'query text'), 'Searching')
})

test('basename extracts trailing filename or directory', () => {
  assert.equal(basename('/a/b/c.ts'), 'c.ts')
  assert.equal(basename('/a/b/c/'), 'c')
  assert.equal(basename('file.ts'), 'file.ts')
})

test('formatChatTime formats relative intervals', () => {
  const now = 100_000
  assert.equal(formatChatTime(now - 10_000, now), 'Just now')
  assert.equal(formatChatTime(now - 120_000, now), '2m ago')
  assert.equal(formatChatTime(0), '')
})

test('formatMessageCount handles counts and plurals', () => {
  assert.equal(formatMessageCount(0), '')
  assert.equal(formatMessageCount(1), '1 message')
  assert.equal(formatMessageCount(5), '5 messages')
})
