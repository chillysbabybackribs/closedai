#!/usr/bin/env node
// Runs search pipeline verification in the visible ClosedAI app, then exits.
import { spawn } from 'node:child_process'
import { sanitizeGpuEnv } from './launch-electron-vite.mjs'

const env = { ...sanitizeGpuEnv().env, CLOSEDAI_LIVE_VERIFY: 'search-pipeline' }
const child = spawn('npm', ['run', 'dev'], { env, stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 1))
