#!/usr/bin/env node
// Control the fast poker autopilot on the already-running ClosedAI app (second-instance IPC).
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { sanitizeGpuEnv } from './launch-electron-vite.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const userData = join(homedir(), '.config', 'closedai')
const statusPath = join(userData, 'poker-autopilot-status.json')

const command = process.argv[2]?.trim() || 'help'

async function printStatus() {
  try {
    const text = await readFile(statusPath, 'utf8')
    console.log(text)
  } catch {
    console.log(JSON.stringify({ running: false, note: 'No status file yet' }, null, 2))
  }
}

function trigger(mode) {
  const child = spawn(electron, ['.', `--live-verify=${mode}`], {
    cwd: root,
    env: sanitizeGpuEnv().env,
    stdio: 'inherit'
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}

if (command === 'start') {
  console.log('[poker-autopilot] Starting on running ClosedAI instance…')
  console.log('[poker-autopilot] Status:', statusPath)
  trigger('poker-autopilot')
} else if (command === 'stop') {
  console.log('[poker-autopilot] Requesting stop…')
  trigger('poker-autopilot-stop')
} else if (command === 'status') {
  void printStatus()
} else {
  console.log(`Usage: node scripts/poker-autopilot.mjs <start|stop|status>

  start   — attach fast autopilot to the open BetOnline table (250ms poll, CDP clicks)
  stop    — request a graceful stop
  status  — print ~/.config/closedai/poker-autopilot-status.json

Optional env:
  CLOSEDAI_POKER_TAB=tab-273     Pin the poker tab id
  CLOSEDAI_POKER_HERO=dirtyddann Hero username for stack parsing
  CLOSEDAI_POKER_AUTOPILOT_MS=…  Max runtime (default 4h)
`)
  process.exit(command === 'help' ? 0 : 1)
}
