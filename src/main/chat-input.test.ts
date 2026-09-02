import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatInput } from './chat-input.ts'

test('builds native app-server input for text, files, and images', () => {
  const result = buildChatInput('  Inspect these  ', [
    { id: 'file-1', kind: 'file', name: 'notes.md', path: '/workspace/notes.md' },
    { id: 'image-1', kind: 'image', name: 'screen.png', source: { type: 'path', path: '/tmp/screen.png' } },
    { id: 'image-2', kind: 'image', name: 'pasted.png', source: { type: 'url', url: 'data:image/png;base64,AA==' } }
  ])

  assert.equal(result.prompt, 'Inspect these')
  assert.deepEqual(result.input, [
    { type: 'text', text: 'Inspect these', text_elements: [] },
    { type: 'mention', name: 'notes.md', path: '/workspace/notes.md' },
    { type: 'localImage', path: '/tmp/screen.png' },
    { type: 'image', url: 'data:image/png;base64,AA==' }
  ])
  assert.deepEqual(result.summaries.map(({ kind, name }) => ({ kind, name })), [
    { kind: 'file', name: 'notes.md' },
    { kind: 'image', name: 'screen.png' },
    { kind: 'image', name: 'pasted.png' }
  ])
})

test('allows an attachment-only turn and rejects unsafe sources', () => {
  assert.deepEqual(
    buildChatInput('', [{ id: '1', kind: 'file', name: 'a.txt', path: '/tmp/a.txt' }]).input,
    [{ type: 'mention', name: 'a.txt', path: '/tmp/a.txt' }]
  )
  assert.throws(
    () => buildChatInput('', [{ id: '1', kind: 'file', name: 'a.txt', path: 'relative.txt' }]),
    /Invalid attachment path/
  )
  assert.throws(
    () => buildChatInput('', [{ id: '1', kind: 'image', name: 'a.png', source: { type: 'url', url: 'https://example.com/a.png' } }]),
    /invalid or too large/
  )
})
