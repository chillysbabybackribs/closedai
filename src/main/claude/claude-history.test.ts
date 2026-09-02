import assert from 'node:assert/strict'
import test from 'node:test'
import { CLAUDE_ARCHIVED_TAG, listClaudeThreads, replayClaudeSession, threadSummaryFromSession } from './claude-history.js'

test('session info becomes a thread summary; archived sessions are hidden', () => {
  assert.deepEqual(threadSummaryFromSession({ sessionId: 's1', summary: 'Ping', customTitle: 'Embedded browser ping', firstPrompt: 'Call the tool\nthen reply', lastModified: 2000, createdAt: 1000 }), {
    id: 'claude:s1', title: 'Embedded browser ping', preview: 'Call the tool\nthen reply', createdAt: 1000, updatedAt: 2000
  })
  assert.equal(threadSummaryFromSession({ sessionId: 's2', summary: '', lastModified: 5 })!.title, 'New chat')
  assert.equal(threadSummaryFromSession({ sessionId: 's3', summary: '', firstPrompt: 'x'.repeat(100), lastModified: 5 })!.title.length, 80)
  assert.equal(threadSummaryFromSession({ sessionId: 's4', summary: 'gone', lastModified: 5, tag: CLAUDE_ARCHIVED_TAG }), null)
})

test('threads list newest first from the workspace directory', async () => {
  const calls: unknown[] = []
  const threads = await listClaudeThreads({
    listSessions: async (options) => {
      calls.push(options)
      return [
        { sessionId: 'old', summary: 'Old', lastModified: 1 },
        { sessionId: 'new', summary: 'New', lastModified: 3 },
        { sessionId: 'hidden', summary: 'Hidden', lastModified: 9, tag: CLAUDE_ARCHIVED_TAG }
      ]
    }
  }, '/w')
  assert.deepEqual(threads.map((thread) => thread.id), ['claude:new', 'claude:old'])
  assert.deepEqual(calls, [{ dir: '/w', limit: 100, includeProgrammatic: true }])
})

test('a stored session replays into ordered transcript items', async () => {
  const items = await replayClaudeSession({
    getSessionMessages: (async () => [
      { type: 'user', uuid: 'u1', session_id: 's', parent_tool_use_id: null, message: { role: 'user', content: 'Run echo' } },
      { type: 'assistant', uuid: 'a1', session_id: 's', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hi' } }] } },
      { type: 'user', uuid: 'u2', session_id: 's', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'hi' }] } },
      { type: 'assistant', uuid: 'a2', session_id: 's', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Done' }] } }
    ]) as never
  }, 's', { cwd: '/w', displayScreenshot: () => null })
  assert.deepEqual(items.map((item) => [item.type, item.turnId]), [['user', 'turn:u1'], ['command', 'turn:u1'], ['assistant', 'turn:u1']])
  assert.equal(items[1]!.type === 'command' && items[1]!.output, 'hi')
})
