import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isHeavyWorkspaceCommand } from '../heavy-work-lock.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function realNpm() {
  return process.env.CLOSEDAI_REAL_NPM?.trim() || 'npm'
}

function realNode() {
  return process.env.CLOSEDAI_REAL_NODE?.trim() || process.execPath
}

function workLockScript() {
  return process.env.CLOSEDAI_WORK_LOCK_SCRIPT?.trim() || join(here, '..', 'work-lock.mjs')
}

function workspaceCwd() {
  return process.env.CLOSEDAI_WORKSPACE_CWD?.trim() || process.cwd()
}

function stripShimFromPath(pathValue) {
  const shimDir = process.env.CLOSEDAI_SHIM_BIN_DIR?.trim()
  if (!shimDir || !pathValue) return pathValue
  const parts = pathValue.split(process.platform === 'win32' ? ';' : ':')
  return parts.filter((part) => part && part !== shimDir).join(process.platform === 'win32' ? ';' : ':')
}

function envForRealCommand() {
  const env = { ...process.env }
  const key = 'Path' in env ? 'Path' : 'PATH'
  env[key] = stripShimFromPath(env[key] ?? '')
  return env
}

function runLocked(command, args) {
  const lock = workLockScript()
  const cwd = workspaceCwd()
  const node = realNode()
  const child = spawn(node, [lock, '--cwd', cwd, '--', command, ...args], {
    cwd,
    stdio: 'inherit',
    env: envForRealCommand()
  })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 1)
  })
}

export function runShim(kind, argv) {
  if (kind !== 'npm') {
    console.error('closedai shim: only npm is supported')
    process.exit(2)
  }
  const args = argv[2] === kind ? argv.slice(3) : argv.slice(2)
  const command = realNpm()
  const head = ['npm', ...args]
  if (process.env.CLOSEDAI_WORK_LOCK_SCRIPT && isHeavyWorkspaceCommand(head)) {
    runLocked(command, args)
    return
  }
  const child = spawn(command, args, {
    cwd: workspaceCwd(),
    stdio: 'inherit',
    env: envForRealCommand()
  })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 1)
  })
}

const entry = process.argv[1]
if (entry && fileURLToPath(import.meta.url) === entry) {
  const kind = process.argv[2]
  runShim(kind, process.argv)
}
