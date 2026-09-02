import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildClaudeUserMessage, contextBlocks, imageFromDataUrl } from './claude-input.js'

test('plain text becomes a string message stamped with the session', async () => {
  const turn = await buildClaudeUserMessage('  hello  ', [], undefined, 'sess')
  assert.equal(turn?.prompt, 'hello')
  assert.deepEqual(turn?.message, { type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null, session_id: 'sess' })
  assert.equal(await buildClaudeUserMessage('   ', [], undefined, null), null)
})

test('context rides ahead of the prompt as tagged text blocks', async () => {
  const context = { 'closedai.chat.handoff': { kind: 'application' as const, value: 'digest' } }
  assert.deepEqual(contextBlocks(context), [{ type: 'text', text: '<closedai_context name="closedai.chat.handoff" kind="application">\ndigest\n</closedai_context>' }])
  const turn = await buildClaudeUserMessage('go', [], context, null)
  const content = turn!.message.message.content as Array<{ type: string; text?: string }>
  assert.equal(content.length, 2)
  assert.equal(content[1]!.text, 'go')
  assert.equal(turn!.message.session_id, '')
})

test('images attach as base64 blocks; files are listed for the Read tool', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-claude-input-'))
  const png = join(dir, 'shot.png')
  await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const turn = await buildClaudeUserMessage('look', [
    { id: '1', kind: 'image', name: 'shot.png', source: { type: 'path', path: png } },
    { id: '2', kind: 'image', name: 'paste', source: { type: 'url', url: 'data:image/jpeg;base64,QUJD' } },
    { id: '3', kind: 'file', name: 'notes.md', source: undefined as never, path: join(dir, 'notes.md') } as never
  ], undefined, null)
  const content = turn!.message.message.content as Array<Record<string, unknown>>
  assert.deepEqual(content.map((block) => block.type), ['image', 'image', 'text', 'text'])
  assert.deepEqual(content[0]!.source, { type: 'base64', media_type: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') })
  assert.deepEqual(content[1]!.source, { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' })
  assert.equal(content[2]!.text, `Attached files (read them with the Read tool):\n- ${join(dir, 'notes.md')}`)
  assert.deepEqual(turn!.summaries.map((summary) => summary.kind), ['image', 'image', 'file'])
})

test('data URLs outside the supported image types are rejected', () => {
  assert.equal(imageFromDataUrl('data:image/svg+xml;base64,AA'), null)
  assert.equal(imageFromDataUrl('data:image/webp;base64,AA')?.type, 'image')
})
