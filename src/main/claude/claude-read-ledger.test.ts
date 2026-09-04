import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ClaudeReadLedger, merge, subtract, type LedgerSkip, type ReadReceipt } from './claude-read-ledger.js'

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const cwd = await mkdtemp(join(tmpdir(), 'closedai-ledger-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const path = join(cwd, 'source.ts')
  await writeFile(path, Array.from({ length: 20 }, (_, index) => 'line ' + (index + 1)).join('\n') + '\n')
  const skips: LedgerSkip[] = []
  const observed: ReadReceipt[] = []
  const ledger = new ClaudeReadLedger((skip) => skips.push(skip), (receipt) => { observed.push(receipt) })
  const response = async (start = 1, count = 20) => {
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n')
    return { type: 'text', file: {
      filePath: path, content: lines.slice(start - 1, start - 1 + count).join('\n'),
      startLine: start, numLines: count, totalLines: lines.length
    } }
  }
  const args = { file_path: path }
  return { cwd, path, args, skips, ledger, response, observed }
}

test('range arithmetic coalesces coverage and retains all missing gaps', () => {
  assert.deepEqual(merge([{ start: 10, end: 20 }, { start: 1, end: 9 }]), [{ start: 1, end: 20 }])
  assert.deepEqual(subtract({ start: 1, end: 100 }, [{ start: 20, end: 30 }, { start: 50, end: 60 }]),
    [{ start: 1, end: 19 }, { start: 31, end: 49 }, { start: 61, end: 100 }])
  assert.deepEqual(subtract({ start: 1, end: Infinity }, [{ start: 1, end: Infinity }]), [])
})

test('verified returned text receives a hash and unchanged covered reads are suppressed', async (t) => {
  const f = await fixture(t)
  const receipt = await f.ledger.after('main', 'Read', f.args, await f.response(1, 10), f.cwd)
  assert.match(receipt!.hash, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual([receipt!.startLine, receipt!.endLine], [1, 10])
  assert.equal((await f.ledger.before('main', 'Read', { ...f.args, offset: 2, limit: 3 }, f.cwd)).kind, 'deny')
  const expanded = await f.ledger.before('main', 'Read', f.args, f.cwd)
  assert.equal(expanded.kind, 'narrow')
  if (expanded.kind === 'narrow') assert.deepEqual(expanded.input, { ...f.args, offset: 11, limit: 10 })
  assert.equal(f.skips.length, 2)
})

test('external edits invalidate all prior ranges without an edit-tool event', async (t) => {
  const f = await fixture(t)
  await f.ledger.after('main', 'Read', f.args, await f.response(), f.cwd)
  await writeFile(f.path, (await readFile(f.path, 'utf8')).replace('line 20', 'changed'))
  assert.equal((await f.ledger.before('main', 'Read', { ...f.args, offset: 1, limit: 2 }, f.cwd)).kind, 'allow')
  await f.ledger.after('main', 'Read', f.args, await f.response(1, 2), f.cwd)
  assert.equal((await f.ledger.before('main', 'Read', { ...f.args, offset: 15, limit: 2 }, f.cwd)).kind, 'allow')
})

test('missing, truncated, stale, and incorrect range metadata never establish coverage', async (t) => {
  const f = await fixture(t)
  const valid = await f.response()
  for (const response of [
    {},
    { ...valid, isError: true },
    { file: { ...valid.file, content: undefined } },
    { file: { ...valid.file, content: 'line 1' } },
    { file: { ...valid.file, numLines: 25 } },
    { file: { ...valid.file, totalLines: 100 } }
  ]) {
    assert.equal(await f.ledger.after('main', 'Read', f.args, response, f.cwd), null)
    assert.equal((await f.ledger.before('main', 'Read', f.args, f.cwd)).kind, 'allow')
  }
  await writeFile(f.path, 'new contents\n')
  assert.equal(await f.ledger.after('main', 'Read', f.args, valid, f.cwd), null)
})

test('shell pipelines and searches remain repeatable and cannot credit unseen source', async (t) => {
  const f = await fixture(t)
  for (const [tool, args, response] of [
    ['Bash', { command: 'cat ' + f.path + ' | head -5' }, { stdout: 'line 1' }],
    ['Bash', { command: 'cat ' + f.path }, { stdout: '' }],
    ['Grep', { pattern: 'line', path: f.path }, { content: 'line 1' }],
    ['Glob', { pattern: '*.ts' }, { filenames: [f.path] }]
  ] as const) {
    await f.ledger.after('main', tool, args, response, f.cwd)
    assert.equal((await f.ledger.before('main', tool, args, f.cwd)).kind, 'allow')
  }
  assert.equal((await f.ledger.before('main', 'Read', f.args, f.cwd)).kind, 'allow')
})

test('canonical aliases share versioned coverage but subagents do not', async (t) => {
  const f = await fixture(t)
  const alias = join(f.cwd, 'alias.ts')
  await symlink(f.path, alias)
  await f.ledger.after('main', 'Read', { file_path: 'alias.ts' }, await f.response(), f.cwd)
  assert.equal((await f.ledger.before('main', 'Read', f.args, f.cwd)).kind, 'deny')
  assert.equal((await f.ledger.before('child', 'Read', f.args, f.cwd)).kind, 'allow')
})

test('reset invalidates pending receipts and allows previously covered reads', async (t) => {
  const f = await fixture(t)
  const pending = f.ledger.after('main', 'Read', f.args, await f.response(), f.cwd)
  f.ledger.reset()
  assert.equal(await pending, null)
  assert.equal((await f.ledger.before('main', 'Read', f.args, f.cwd)).kind, 'allow')
})

test('native hooks preserve output, add the receipt, and forget coverage on compaction', async (t) => {
  const f = await fixture(t)
  const hooks = f.ledger.hooks()
  const base = { session_id: 's', transcript_path: '/t', cwd: f.cwd }
  const options = { signal: new AbortController().signal }
  const response = await f.response()
  await hooks.PreToolUse![0]!.hooks[0]!({
    ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: f.args, tool_use_id: 'r'
  }, 'r', options)
  const result = await hooks.PostToolUse![0]!.hooks[0]!({
    ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: f.args,
    tool_response: response, tool_use_id: 'r'
  }, 'r', options)
  const updated = (result as { hookSpecificOutput: { updatedToolOutput: typeof response & { closedai_read: { hash: string } } } }).hookSpecificOutput.updatedToolOutput
  assert.deepEqual(updated.file, response.file)
  assert.match(updated.closedai_read.hash, /^sha256:/)
  assert.equal(f.observed.length, 1)
  assert.equal(f.observed[0]!.hash, updated.closedai_read.hash)
  assert.equal((await f.ledger.before('main', 'Read', f.args, f.cwd)).kind, 'deny')
  await hooks.PreCompact![0]!.hooks[0]!({ ...base, hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null }, undefined, options)
  assert.equal((await f.ledger.before('main', 'Read', f.args, f.cwd)).kind, 'allow')
  await hooks.PreToolUse![0]!.hooks[0]!({
    ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: f.args, tool_use_id: 'late'
  }, 'late', options)
  f.ledger.reset()
  const late = await hooks.PostToolUse![0]!.hooks[0]!({
    ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: f.args,
    tool_response: response, tool_use_id: 'late'
  }, 'late', options)
  assert.deepEqual(late, {})
  assert.equal(f.observed.length, 1, 'a stale native result must not become a source observation')
  assert.equal((await f.ledger.before('main', 'Read', f.args, f.cwd)).kind, 'allow')
})

test('deleted, volatile, and out-of-workspace paths fail open for native reads', async (t) => {
  const f = await fixture(t)
  const response = await f.response()
  assert.equal(await f.ledger.after('main', 'Read', f.args, response, join(f.cwd, 'nested')), null)
  const log = join(f.cwd, 'task.log')
  await writeFile(log, await readFile(f.path))
  assert.equal(await f.ledger.after('main', 'Read', { file_path: log }, response, f.cwd), null)
  await f.ledger.after('main', 'Read', f.args, response, f.cwd)
  await rm(f.path)
  assert.equal((await f.ledger.before('main', 'Read', f.args, f.cwd)).kind, 'allow')
})
