import assert from 'node:assert/strict'
import test from 'node:test'
import { ClaudeReadLedger, merge, parseShell, subtract, type LedgerSkip } from './claude-read-ledger.js'

const cwd = '/w'
const file = '/w/src/main/chat-hub.ts'

function ledger() {
  const skips: LedgerSkip[] = []
  const instance = new ClaudeReadLedger((skip) => skips.push(skip))
  const read = (offset?: number, limit?: number, total = 400) => {
    const input = { file_path: file, ...(offset ? { offset } : {}), ...(limit ? { limit } : {}) }
    const verdict = instance.before('main', 'Read', input, cwd)
    if (verdict.kind === 'deny') return verdict
    const applied = verdict.kind === 'narrow' ? verdict.input : input
    const start = Number(applied.offset ?? 1)
    const count = applied.limit === undefined ? total - start + 1 : Number(applied.limit)
    instance.after('main', 'Read', applied, { file: { filePath: file, startLine: start, numLines: count, totalLines: total } }, cwd)
    return verdict
  }
  return { instance, skips, read }
}

test('range arithmetic merges touching ranges and subtracts covered lines', () => {
  assert.deepEqual(merge([{ start: 10, end: 20 }, { start: 1, end: 9 }, { start: 30, end: 40 }]), [{ start: 1, end: 20 }, { start: 30, end: 40 }])
  assert.deepEqual(subtract({ start: 1, end: 100 }, [{ start: 20, end: 30 }, { start: 50, end: 60 }]), [{ start: 1, end: 19 }, { start: 31, end: 49 }, { start: 61, end: 100 }])
  assert.deepEqual(subtract({ start: 5, end: 10 }, [{ start: 1, end: 100 }]), [])
  assert.deepEqual(subtract({ start: 1, end: Number.POSITIVE_INFINITY }, [{ start: 1, end: Number.POSITIVE_INFINITY }]), [])
})

test('a read inside lines already returned this turn is denied with the earlier range named', () => {
  const { read, skips } = ledger()
  assert.equal(read(1, 120).kind, 'allow')
  const again = read(20, 30)
  assert.equal(again.kind, 'deny')
  assert.match((again as { reason: string }).reason, /chat-hub\.ts lines 20-49 were already returned earlier in this turn/)
  assert.deepEqual(skips, [{ tool: 'Read', path: file, lines: 30, verdict: 'deny' }])
})

test('a read that only partly overlaps is narrowed to the missing lines with a note', () => {
  const { read, skips } = ledger()
  read(261, 140)
  const widened = read(1, 400)
  assert.equal(widened.kind, 'narrow')
  const narrow = widened as { input: Record<string, unknown>; note: string }
  assert.deepEqual(narrow.input, { file_path: file, offset: 1, limit: 260 })
  assert.match(narrow.note, /lines 261-400 were left out of this read/)
  assert.deepEqual(skips, [{ tool: 'Read', path: file, lines: 140, verdict: 'narrow' }])
  // Everything is now in context, so the whole file is refused outright.
  assert.equal(read().kind, 'deny')
})

test('a read with gaps on both sides is left alone', () => {
  const { read } = ledger()
  read(100, 50)
  assert.equal(read(1, 400).kind, 'allow')
})

test('editing the file, a tree-changing shell command, or a new turn forgets what was read', () => {
  const { instance, read } = ledger()
  read(1, 100)
  instance.before('main', 'Edit', { file_path: file, old_string: 'a', new_string: 'b' }, cwd)
  assert.equal(read(1, 100).kind, 'allow')
  instance.before('main', 'Bash', { command: 'git checkout -- src' }, cwd)
  assert.equal(read(1, 100).kind, 'allow')
  instance.before('main', 'Bash', { command: 'npm test' }, cwd)
  assert.equal(read(1, 100).kind, 'deny', 'a command that does not name the file keeps its ledger')
  instance.before('main', 'Bash', { command: `node scripts/fix.mjs src/main/chat-hub.ts` }, cwd)
  assert.equal(read(1, 100).kind, 'allow', 'a command naming the file forgets it')
  instance.reset()
  assert.equal(read(1, 100).kind, 'allow')
})

test('shell reads are recognised, recorded, and denied when fully covered', () => {
  const { instance } = ledger()
  const parsed = parseShell("sed -n '1,40p' src/main/chat-hub.ts; sed -n 70,90p src/main/chat-hub.ts && cat -n src/shared/chat.ts | head -5", cwd)
  assert.equal(parsed.pureRead, true)
  assert.deepEqual(parsed.reads, [
    { path: file, range: { start: 1, end: 40 } },
    { path: file, range: { start: 70, end: 90 } },
    { path: '/w/src/shared/chat.ts', range: { start: 1, end: Number.POSITIVE_INFINITY } }
  ])
  assert.equal(parseShell('cat a.ts > b.ts', cwd).pureRead, false)
  assert.equal(parseShell("sed -i 's/a/b/' a.ts", cwd).pureRead, false)
  assert.equal(parseShell('git diff --stat && rg -n foo src', cwd).pureRead, true)
  assert.equal(parseShell('git commit -m x', cwd).pureRead, false)

  const command = { command: "sed -n '1,40p' src/main/chat-hub.ts" }
  assert.equal(instance.before('main', 'Bash', command, cwd).kind, 'allow')
  instance.after('main', 'Bash', command, { stdout: '' }, cwd)
  const again = instance.before('main', 'Bash', { command: "sed -n '10,20p' src/main/chat-hub.ts" }, cwd)
  assert.equal(again.kind, 'deny')
  assert.match((again as { reason: string }).reason, /Read tool takes offset and limit/)
  // A mixed command with a search segment is never denied.
  assert.equal(instance.before('main', 'Bash', { command: "sed -n '10,20p' src/main/chat-hub.ts; rg -n foo src" }, cwd).kind, 'allow')
})

test('volatile files and paths outside the workspace are never ledgered, so polling them stays allowed', () => {
  const { instance } = ledger()
  for (const path of ['/w/out/main/index.js', '/w/node_modules/x/index.js', '/w/tasks/abc.output', '/elsewhere/file.ts']) {
    instance.after('main', 'Read', { file_path: path }, { file: { filePath: path, startLine: 1, numLines: 10, totalLines: 10 } }, cwd)
    assert.equal(instance.before('main', 'Read', { file_path: path }, cwd).kind, 'allow', path)
  }
  const poll = { command: 'cat /w/tasks/abc.output 2>/dev/null | tail -3' }
  instance.after('main', 'Bash', poll, {}, cwd)
  assert.equal(instance.before('main', 'Bash', poll, cwd).kind, 'allow')
})

test('an identical pure text-search shell command is denied until something is edited', () => {
  const { instance } = ledger()
  const search = { command: 'rg -n "markdown|Markdown" src --type ts' }
  assert.equal(instance.before('main', 'Bash', search, cwd).kind, 'allow')
  instance.after('main', 'Bash', search, { stdout: 'x' }, cwd)
  assert.equal(instance.before('main', 'Bash', search, cwd).kind, 'deny')
  assert.equal(instance.before('main', 'Bash', { command: 'rg -n "markdown|Markdown" src' }, cwd).kind, 'allow', 'a different query is a new search')
  const listing = { command: 'ls src/main' }
  instance.after('main', 'Bash', listing, {}, cwd)
  assert.equal(instance.before('main', 'Bash', listing, cwd).kind, 'allow', 'listings are not deduplicated')
  instance.before('main', 'Edit', { file_path: file, old_string: 'a', new_string: 'b' }, cwd)
  assert.equal(instance.before('main', 'Bash', search, cwd).kind, 'allow')
})

test('an identical Grep or Glob is denied until something is edited', () => {
  const { instance } = ledger()
  const input = { pattern: 'continueInNewThread', path: 'src', output_mode: 'files_with_matches' }
  assert.equal(instance.before('main', 'Grep', input, cwd).kind, 'allow')
  instance.after('main', 'Grep', input, { content: 'x' }, cwd)
  assert.equal(instance.before('main', 'Grep', { output_mode: 'files_with_matches', path: 'src', pattern: 'continueInNewThread' }, cwd).kind, 'deny')
  assert.equal(instance.before('main', 'Grep', { ...input, path: 'src/main' }, cwd).kind, 'allow')
  instance.before('main', 'Write', { file_path: '/w/new.ts', content: '' }, cwd)
  assert.equal(instance.before('main', 'Grep', input, cwd).kind, 'allow')
})

test('subagents keep their own ledger and the hooks route by agent id', async () => {
  const { instance, read } = ledger()
  read(1, 100)
  const hooks = instance.hooks()
  const pre = hooks.PreToolUse![0]!.hooks[0]!
  const base = { session_id: 's', transcript_path: '/t', cwd, hook_event_name: 'PreToolUse' as const, tool_use_id: 'u' }
  const subagent = await pre({ ...base, agent_id: 'a1', tool_name: 'Read', tool_input: { file_path: file, offset: 1, limit: 100 } }, 'u', { signal: new AbortController().signal })
  assert.deepEqual(subagent, {})
  const main = await pre({ ...base, tool_name: 'Read', tool_input: { file_path: file, offset: 1, limit: 100 } }, 'u', { signal: new AbortController().signal })
  assert.equal((main as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision, 'deny')
  await hooks.UserPromptSubmit![0]!.hooks[0]!({ session_id: 's', transcript_path: '/t', cwd, hook_event_name: 'UserPromptSubmit', prompt: 'next' }, undefined, { signal: new AbortController().signal })
  assert.equal(read(1, 100).kind, 'allow')
})
