import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { quarantinePath, readJsonOrQuarantine } from './corrupt-file-quarantine.ts'

async function tempFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'closedai-quarantine-')), 'store.json')
}

test('a missing file reads as null and leaves the directory untouched', async () => {
  const file = await tempFile()
  assert.equal(await readJsonOrQuarantine(file, 'store'), null)
  assert.deepEqual(await readdir(join(file, '..')), [])
})

test('valid JSON is returned parsed', async () => {
  const file = await tempFile()
  await writeFile(file, '{"a":1}')
  assert.deepEqual(await readJsonOrQuarantine(file, 'store'), { a: 1 })
})

test('malformed JSON is moved aside with its bytes intact instead of being overwritten', async () => {
  const file = await tempFile()
  await writeFile(file, '{"a":')
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  try {
    assert.equal(await readJsonOrQuarantine(file, 'store'), null)
  } finally {
    console.warn = original
  }
  const entries = await readdir(join(file, '..'))
  assert.equal(entries.length, 1)
  assert.match(entries[0]!, /^store\.json\.corrupt-\d{4}-\d{2}-\d{2}T/)
  assert.equal(await readFile(join(file, '..', entries[0]!), 'utf8'), '{"a":')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0]!, /store unreadable/)
})

test('quarantine names carry the ISO time', () => {
  assert.equal(quarantinePath('/x/a.json', new Date('2026-09-21T10:00:00.000Z')), '/x/a.json.corrupt-2026-09-21T10:00:00.000Z')
})
