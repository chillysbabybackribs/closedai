import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveHtmlPreview } from './preview-html.js'

test('resolveHtmlPreview accepts relative html under cwd', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'closedai-preview-'))
  const file = path.join(cwd, 'mock.html')
  await writeFile(file, '<!doctype html><title>x</title>')
  const resolved = await resolveHtmlPreview('mock.html', cwd)
  assert.equal(resolved.path, file)
  assert.match(resolved.fileUrl, /^file:\/\//)
})

test('resolveHtmlPreview rejects paths outside cwd and non-html', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'closedai-preview-'))
  await assert.rejects(resolveHtmlPreview('../outside.html', cwd), /inside the chat working directory/)
  const txt = path.join(cwd, 'note.txt')
  await writeFile(txt, 'hi')
  await assert.rejects(resolveHtmlPreview('note.txt', cwd), /\.html/)
})
