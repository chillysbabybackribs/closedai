import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isHeavyWorkspaceCommand } from '../heavy-work-lock.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function realBinary(kind) {
  const key = kind === 'npm' ? 'CLOSEDAI_REAL_NPM' : 'CLOSEDAI_REAL_NODE'
  if (process.env[key]?.trim()) return process.env[key].trim()
  return kind === 'node' ? process.execPath : kind
}

function workLockScript() {
  return process.env.CLOSEDAI_WORK_LOCK_SCRIPT?.trim() || join(here, '..', 'work-lock.mjs')
}

function workspaceCwd() {
  return process.env.CLOSEDAI_WORKSPACE_CWD?.trim() || process.cwd()
}

function runLocked(command, args) {
  const lock = workLockScript()
  const cwd = workspaceCwd()
  const child = spawn(process.execPath, [lock, '--cwd', cwd, '--', command, ...args], {
    cwd,
    stdio: 'inherit',
    env: process.env
  })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 1)
  })
}

export function runShim(kind, argv) {
  const args = argv[2] === kind ? argv.slice(3) : argv.slice(2)
  const command = realBinary(kind)
  const head = [basename(command), ...args]
  if (process.env.CLOSEDAI_WORK_LOCK_SCRIPT && isHeavyWorkspaceCommand(head)) {
    runLocked(command, args)
    return
  }
  const child = spawn(command, args, { cwd: workspaceCwd(), stdio: 'inherit', env: process.env })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 1)
  })
}

function basename(token) {
  const slash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'))
  return slash >= 0 ? token.slice(slash + 1) : token
}

const entry = process.argv[1]
if (entry && fileURLToPath(import.meta.url) === entry) {
  const kind = process.argv[2]
  if (kind !== 'npm' && kind !== 'node') {
    console.error('closedai shim: expected npm or node')
    process.exit(2)
  }
  runShim(kind, process.argv)
}
