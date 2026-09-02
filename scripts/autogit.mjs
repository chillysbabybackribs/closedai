#!/usr/bin/env node
// Auto-git: snapshot the working tree into commits so nobody has to think about git.
//
// Safety contract (the reason earlier auto-git attempts broke things is that they did more):
//   - It only ever runs `git add` and `git commit`. Never checkout, reset --hard, stash,
//     pull, rebase, merge, or branch switches. The working tree is never modified.
//   - It commits to whatever branch is checked out and refuses to act on a detached HEAD or
//     while a merge/rebase/cherry-pick is in progress.
//   - It refuses to stage secrets (.env, keys, tokens) and files over 5 MB; those are left
//     unstaged with a warning so a human decides.
//   - One instance per repo (pid lock); it waits out git's own index.lock.
//   - Push is off unless AUTOGIT_PUSH=1 and the branch has an upstream.
//
// Usage:  node scripts/autogit.mjs [run|once|status|install|uninstall]
//   run        watch the repo and commit after AUTOGIT_QUIET_MS of quiet (default)
//   once       commit now if there is anything to commit, then exit
//   status     print what would be committed
//   install    write + enable a systemd user service so this runs whenever you're logged in
//   uninstall  stop + remove that service
// Env: AUTOGIT_QUIET_MS (20000) AUTOGIT_MAX_WAIT_MS (180000) AUTOGIT_VERIFY (1) AUTOGIT_PUSH (0)

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const QUIET_MS = Number(process.env.AUTOGIT_QUIET_MS ?? 20_000)
const MAX_WAIT_MS = Number(process.env.AUTOGIT_MAX_WAIT_MS ?? 180_000)
const TICK_MS = 60_000
const VERIFY = process.env.AUTOGIT_VERIFY !== '0'
const PUSH = process.env.AUTOGIT_PUSH === '1'
const MAX_FILE_BYTES = 5 * 1024 * 1024
// Credential-shaped files only: source files that merely mention tokens (control-tokens.css)
// must not trip this.
const SECRET_PATH = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore)|id_(rsa|ed25519|ecdsa)(\.pub)?|auth\.json|credentials?(\.[a-z]+)?|secrets?(\.[a-z]+)?|.*tokens?\.(json|txt|ya?ml|toml|env))$/i
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', '.claude'])
const SERVICE = 'closedai-autogit'
const LOCK = join(ROOT, '.git', 'autogit.lock')

const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts)

async function git(args, opts = {}) {
  const { stdout } = await exec('git', args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024, ...opts })
  return stdout
}

// ---- Repository state checks ---------------------------------------------------------

async function blockedReason() {
  const gitDir = (await git(['rev-parse', '--git-dir'])).trim()
  const abs = resolve(ROOT, gitDir)
  for (const marker of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply']) {
    if (existsSync(join(abs, marker))) return `a ${marker.replace(/_HEAD|-merge|-apply/, '').toLowerCase()} is in progress`
  }
  const head = (await git(['symbolic-ref', '-q', 'HEAD']).catch(() => '')).trim()
  if (!head) return 'HEAD is detached'
  return null
}

async function changedPaths() {
  const out = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const paths = []
  const entries = out.split('\0').filter(Boolean)
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    if (code[0] === 'R' || code[0] === 'C') i += 1 // rename/copy carries the old path next
    paths.push({ code, path })
  }
  return paths
}

function guard(path) {
  if (SECRET_PATH.test(path)) return 'looks like a secret'
  try {
    const size = statSync(join(ROOT, path)).size
    if (size > MAX_FILE_BYTES) return `${(size / 1024 / 1024).toFixed(1)} MB is over the ${MAX_FILE_BYTES / 1024 / 1024} MB limit`
  } catch {
    // Deleted files have no size; deletions are always fine to record.
  }
  return null
}

function summarize(paths) {
  const groups = new Map()
  for (const { path } of paths) {
    const parts = path.split('/')
    const key = parts.length > 2 ? parts.slice(0, 2).join('/') : parts.length === 2 ? parts[0] : path
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1] - a[1])
  const head = ranked.slice(0, 4).map(([key, count]) => (count > 1 ? `${key} (${count})` : key)).join(', ')
  const more = ranked.length > 4 ? ` +${ranked.length - 4} more` : ''
  return `auto: ${head}${more}`
}

async function typecheck() {
  if (!existsSync(join(ROOT, 'node_modules'))) return 'skipped (no node_modules)'
  try {
    await exec('npx', ['tsc', '--noEmit'], { cwd: ROOT, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
    return 'ok'
  } catch (error) {
    const firstLine = String(error.stdout ?? error.message).split('\n').find((line) => line.includes('error TS')) ?? 'failed'
    return `failed — ${firstLine.trim().slice(0, 160)}`
  }
}

// ---- Commit ----------------------------------------------------------------------------

async function commitOnce({ dryRun = false } = {}) {
  const blocked = await blockedReason()
  if (blocked) { log(`skip: ${blocked}`); return false }
  const paths = await changedPaths()
  if (paths.length === 0) return false
  const kept = []
  const refused = []
  for (const entry of paths) {
    const reason = entry.code.includes('D') ? null : guard(entry.path)
    if (reason) refused.push(`${entry.path}: ${reason}`)
    else kept.push(entry)
  }
  for (const line of refused) log(`refusing to stage ${line}`)
  if (kept.length === 0) return false
  const subject = summarize(kept)
  if (dryRun) {
    console.log(subject)
    for (const { code, path } of kept) console.log(`  ${code.trim() || '??'} ${path}`)
    return true
  }
  await git(['add', '-A', '--', ...kept.map((entry) => entry.path)])
  const verify = VERIFY ? await typecheck() : null
  const body = [
    ...kept.slice(0, 40).map(({ code, path }) => `${code.trim() || '??'} ${path}`),
    ...(kept.length > 40 ? [`… ${kept.length - 40} more`] : []),
    ...(verify ? ['', `Typecheck: ${verify}`] : []),
    ...(refused.length ? ['', 'Left unstaged:', ...refused.map((line) => `  ${line}`)] : [])
  ].join('\n')
  const branch = (await git(['symbolic-ref', '--short', 'HEAD'])).trim()
  await git(['commit', '--quiet', '--no-verify', '-m', subject, '-m', body])
  const hash = (await git(['rev-parse', '--short', 'HEAD'])).trim()
  log(`${hash} on ${branch}: ${subject} (${kept.length} file${kept.length === 1 ? '' : 's'}${verify ? `, typecheck ${verify.split(' ')[0]}` : ''})`)
  if (PUSH) await push(branch)
  return true
}

async function push(branch) {
  const upstream = (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => '')).trim()
  if (!upstream) { log('push skipped: no upstream'); return }
  try { await git(['push', '--quiet']); log(`pushed ${branch} → ${upstream}`) }
  catch (error) { log(`push failed: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`) }
}

async function safeCommit(opts) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { return await commitOnce(opts) }
    catch (error) {
      const text = String(error.stderr ?? error.message)
      if (!/index\.lock/.test(text)) { log(`git error: ${text.trim().split('\n')[0]}`); return false }
      await new Promise((resolve) => setTimeout(resolve, 2_000)) // another git process; wait it out
    }
  }
  return false
}

// ---- Watch loop ------------------------------------------------------------------------

function takeLock() {
  try {
    const pid = Number(readFileSync(LOCK, 'utf8'))
    if (pid && pid !== process.pid) { process.kill(pid, 0); return false }
  } catch {
    // No lock, unreadable lock, or the owner is gone.
  }
  writeFileSync(LOCK, String(process.pid))
  process.on('exit', () => { try { if (Number(readFileSync(LOCK, 'utf8')) === process.pid) unlinkSync(LOCK) } catch { /* ignore */ } })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0))
  return true
}

async function run() {
  if (!takeLock()) { console.error('autogit is already running for this repository'); process.exit(1) }
  log(`watching ${ROOT} (quiet ${QUIET_MS / 1000}s, max wait ${MAX_WAIT_MS / 1000}s, verify ${VERIFY ? 'on' : 'off'}, push ${PUSH ? 'on' : 'off'})`)
  let quietTimer = null
  let firstChangeAt = null
  let busy = false
  const flush = async () => {
    if (busy) return
    busy = true
    clearTimeout(quietTimer); quietTimer = null; firstChangeAt = null
    try { await safeCommit() } finally { busy = false }
  }
  const onChange = (_event, filename) => {
    const rel = String(filename ?? '')
    if (rel.split('/').some((part) => IGNORED_DIRS.has(part))) return
    const now = Date.now()
    firstChangeAt ??= now
    clearTimeout(quietTimer)
    const wait = Math.max(0, Math.min(QUIET_MS, firstChangeAt + MAX_WAIT_MS - now))
    quietTimer = setTimeout(flush, wait)
  }
  watch(ROOT, { recursive: true }, onChange).on('error', (error) => log(`watch error: ${error.message}`))
  setInterval(() => { if (!quietTimer) void flush() }, TICK_MS)
  await flush()
}

// ---- systemd user service ----------------------------------------------------------------

function unitPath() {
  return join(homedir(), '.config', 'systemd', 'user', `${SERVICE}.service`)
}

async function install() {
  const unit = `[Unit]
Description=ClosedAI auto-git snapshots (${ROOT})

[Service]
WorkingDirectory=${ROOT}
ExecStart=${process.execPath} ${join(ROOT, 'scripts', 'autogit.mjs')} run
Environment=PATH=${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
  mkdirSync(dirname(unitPath()), { recursive: true })
  writeFileSync(unitPath(), unit)
  await exec('systemctl', ['--user', 'daemon-reload'])
  await exec('systemctl', ['--user', 'enable', '--now', SERVICE])
  console.log(`installed ${unitPath()}\nlogs: journalctl --user -u ${SERVICE} -f`)
}

async function uninstall() {
  await exec('systemctl', ['--user', 'disable', '--now', SERVICE]).catch(() => {})
  try { unlinkSync(unitPath()) } catch { /* already gone */ }
  await exec('systemctl', ['--user', 'daemon-reload'])
  console.log(`removed ${SERVICE}`)
}

const command = process.argv[2] ?? 'run'
const commands = { run, once: () => safeCommit(), status: () => safeCommit({ dryRun: true }), install, uninstall }
if (!commands[command]) { console.error(`unknown command: ${command}`); process.exit(2) }
commands[command]().catch((error) => { console.error(error.message ?? error); process.exit(1) })
