#!/usr/bin/env node
// Ask the already-running ClosedAI app to verify browser tools in its live browser.
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { sanitizeGpuEnv } from './launch-electron-vite.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn(electron, ['.', '--live-verify=browser'], {
  cwd: root,
  env: sanitizeGpuEnv().env,
  stdio: 'inherit'
})
child.on('exit', (code) => process.exit(code ?? 0))
