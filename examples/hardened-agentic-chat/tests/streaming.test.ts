import assert from 'node:assert/strict'
import test from 'node:test'
import { createSSEParser } from '../protocol/stream-parser.js'
import { repairStreamingMarkdown, sanitizeMarkdownContent } from '../client/markdown-repair.js'
import { createStreamingChatResponse } from '../server/route.js'
import type { StreamEvent } from '../protocol/stream-types.js'

test('SSE Parser: correctly parses complete events and ignores comments', () => {
  const events: StreamEvent[] = []
  const comments: string[] = []

  const parser = createSSEParser({
    onEvent: (e) => events.push(e),
    onComment: (c) => comments.push(c)
  })

  parser.feedString(': ping\n\ndata: {"type":"text-delta","delta":"Hello "}\n\n')
  parser.feedString('data: {"type":"text-delta","delta":"world!"}\n\n')
  parser.flush()

  assert.equal(comments.length, 1)
  assert.equal(comments[0], 'ping')
  assert.equal(events.length, 2)
  assert.deepEqual(events[0], { type: 'text-delta', delta: 'Hello ' })
  assert.deepEqual(events[1], { type: 'text-delta', delta: 'world!' })
})

test('SSE Parser: handles multi-byte UTF-8 split across Uint8Array chunk boundaries', () => {
  const events: StreamEvent[] = []
  const parser = createSSEParser({
    onEvent: (e) => events.push(e)
  })

  // Encode a string containing multi-byte UTF-8 (rocket emoji: 4 bytes [0xF0, 0x9F, 0x9A, 0x80])
  const fullText = 'data: {"type":"text-delta","delta":"Rocket 🚀"}\n\n'
  const encoder = new TextEncoder()
  const bytes = encoder.encode(fullText)

  // Find index of rocket emoji bytes inside byte array
  // Split right in the middle of the rocket emoji bytes
  const splitPoint = bytes.indexOf(0xf0) + 2
  const chunk1 = bytes.slice(0, splitPoint)
  const chunk2 = bytes.slice(splitPoint)

  parser.feed(chunk1)
  assert.equal(events.length, 0, 'Should not dispatch incomplete event yet')

  parser.feed(chunk2)
  parser.flush()

  assert.equal(events.length, 1)
  assert.deepEqual(events[0], { type: 'text-delta', delta: 'Rocket 🚀' })
})

test('Markdown Repair: closes unclosed code blocks during streaming', () => {
  const incompleteCode = '```typescript\nfunction add(a: number, b: number) {\n  return a + b;\n}'
  const result = repairStreamingMarkdown(incompleteCode)

  assert.equal(result.isInsideCodeBlock, true)
  assert.equal(result.activeLanguage, 'typescript')
  assert.ok(result.repairedText.endsWith('```\n'), 'Should append closing fence')
  assert.ok(result.repairedText.startsWith('```typescript\n'))
})

test('Markdown Repair: leaves complete code blocks intact', () => {
  const completeCode = '```python\nprint("hello")\n```\nSome trailing text'
  const result = repairStreamingMarkdown(completeCode)

  assert.equal(result.isInsideCodeBlock, false)
  assert.equal(result.repairedText, completeCode)
})

test('Markdown Repair: fixes dangling bold, links, and incomplete table rows', () => {
  // Bold
  const unclosedBold = 'This is **very important'
  assert.equal(repairStreamingMarkdown(unclosedBold).repairedText, 'This is **very important**')

  // Incomplete link
  const unclosedLink = 'Check out [our website](https://example.com'
  assert.equal(
    repairStreamingMarkdown(unclosedLink).repairedText,
    'Check out [our website](https://example.com)'
  )

  // Incomplete table row
  const tableRow = '| Column 1 | Column 2'
  assert.equal(repairStreamingMarkdown(tableRow).repairedText, '| Column 1 | Column 2 |')
})

test('Sanitization: neutralizes unsafe scripts and malicious links', () => {
  const maliciousMarkdown = `
Hello world!
<script>alert('xss')</script>
<iframe src="javascript:alert(1)"></iframe>
[Click here](javascript:stealTokens())
[Safe link](https://example.com)
<div onerror="alert(1)">Content</div>
`
  const sanitized = sanitizeMarkdownContent(maliciousMarkdown)

  assert.ok(!sanitized.includes('<script>'))
  assert.ok(!sanitized.includes('<iframe>'))
  assert.ok(!sanitized.includes('javascript:stealTokens()'))
  assert.ok(!sanitized.includes('onerror='))
  assert.ok(sanitized.includes('#blocked-unsafe-link'))
  assert.ok(sanitized.includes('https://example.com'))
})

test('Route handler: returns standard streaming SSE response with correct headers', async () => {
  const request = new Request('http://localhost:3000/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Is 17 prime?' })
  })

  const response = createStreamingChatResponse(request)

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8')
  assert.equal(response.headers.get('Cache-Control'), 'no-cache, no-transform')
  assert.equal(response.headers.get('Connection'), 'keep-alive')
  assert.equal(response.headers.get('X-Accel-Buffering'), 'no')

  assert.ok(response.body)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let receivedFirstChunk = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value)
    if (text.length > 0) {
      receivedFirstChunk = true
      break
    }
  }

  await reader.cancel()
  assert.ok(receivedFirstChunk, 'Should receive first SSE event chunk')
})
