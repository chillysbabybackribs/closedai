#!/usr/bin/env node
/**
 * Serialize heavy build/verify work per workspace cwd.
 * Usage: node scripts/work-lock.mjs [--cwd DIR] -- command [args...]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const STALE_MS = 4 * 60 * 60 * 1000
const RETRY_MS = 500
const WAIT_MS = 120_000

function parseArgs(argv) {
  let cwd = process.cwd()
  const command = []
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--cwd' && argv[index + 1]) {
      cwd = path.resolve(argv[++index])
      continue
    }
    if (token === '--') {
      command.push(...argv.slice(index + 1))
      break
    }
  }
  if (command.length === 0) {
    console.error('work-lock: missing command after --')
    process.exit(2)
  }
  return { cwd, command }
}

function readLock(lockPath) {
  try {
    const text = fs.readFileSync(lockPath, 'utf8')
    const [pidLine, atLine] = text.split('\n')
    const pid = Number(pidLine)
    const at = Number(atLine)
    if (!Number.isFinite(pid) || !Number.isFinite(at)) return null
    return { pid, at }
  } catch {
    return null
  }
}

function lockStale(lockPath) {
  const parsed = readLock(lockPath)
  if (!parsed) return true
  if (Date.now() - parsed.at > STALE_MS) return true
  try {
    process.kill(parsed.pid, 0)
    return false
  } catch {
    return true
  }
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  try {
    const fd = fs.openSync(lockPath, 'wx')
    fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`)
    fs.closeSync(fd)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      if (lockStale(lockPath)) {
        fs.unlinkSync(lockPath)
        return acquireLock(lockPath)
      }
      return false
    }
    throw error
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForLock(lockPath) {
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    if (acquireLock(lockPath)) return
    await sleep(RETRY_MS)
  }
  console.error(`work-lock: timed out waiting for ${lockPath}`)
  process.exit(1)
}

const { cwd, command } = parseArgs(process.argv)
const lockPath = path.join(cwd, '.closedai', 'work.lock')

await waitForLock(lockPath)

const child = spawn(command[0], command.slice(1), { cwd, stdio: 'inherit', env: process.env })
child.on('exit', (code, signal) => {
  try {
    fs.unlinkSync(lockPath)
  } catch {
    // ignore
  }
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
