// One managed Vite server per checkout. No Electron or provider processes are started.
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = await realpath(join(dirname(fileURLToPath(import.meta.url)), '..'))
const identity = createHash('sha256').update(root).digest('hex').slice(0, 20)
const directory = join(tmpdir(), `closedai-ui-preview-${process.getuid?.() ?? 'user'}-${identity}`)
const stateFile = join(directory, 'server.json')
const lockFile = join(directory, 'launcher.lock')
const logFile = join(directory, 'server.log')
const protocol = 1
const command = process.argv[2] ?? 'start'
const scenario = process.argv[3] ?? 'conversation'
const scenarios = ['conversation', 'empty', 'streaming', 'settings', 'split', 'unavailable']

async function readState() {
  try { return JSON.parse(await readFile(stateFile, 'utf8')) } catch { return null }
}

async function healthy() {
  const state = await readState()
  if (!state || state.root !== root || state.protocol !== protocol || !Number.isInteger(state.pid)) return null
  // Metadata is not authority to request arbitrary URLs or terminate arbitrary processes.
  let url
  try { url = new URL(state.url) } catch { return null }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) return null
  try {
    const response = await fetch(`${url.origin}/__closedai_preview`, { signal: AbortSignal.timeout(800), redirect: 'error' })
    const reply = await response.json()
    return reply.instance === state.instance && reply.root === root && reply.pid === state.pid
      && reply.protocol === protocol ? state : null
  } catch { return null }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

async function acquireLock() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const file = await open(lockFile, 'wx', 0o600)
      await file.writeFile(String(process.pid))
      await file.close()
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = Number(await readFile(lockFile, 'utf8').catch(() => '0'))
      // A freshly created lock may not yet contain the owner's pid.
      if (owner > 0 && !alive(owner)) await rm(lockFile, { force: true })
      else await delay(100)
    }
  }
  throw new Error(`Timed out waiting for preview launcher lock: ${lockFile}`)
}

function printState(state, reused) {
  console.log(JSON.stringify({ status: 'running', reused, pid: state.pid,
    url: `${state.url}/?scenario=${scenario}`, scenarios: Object.fromEntries(scenarios.map((name) =>
      [name, `${state.url}/?scenario=${name}`])), log: logFile,
    readiness: 'Wait for html[data-preview-state="ready"]; inspect the browser console for rendering errors.' }, null, 2))
}

async function serve() {
  const { createServer } = await import('vite')
  const instance = randomUUID()
  const state = { root, protocol, instance, pid: process.pid, url: '' }
  const server = await createServer({ root: join(root, 'src/renderer'),
    configFile: join(root, 'web.vite.config.ts'), clearScreen: false,
    server: { host: '127.0.0.1', port: 5173, strictPort: false },
    plugins: [{ name: 'closedai-preview-health', configureServer(vite) {
      vite.middlewares.use('/__closedai_preview', (_request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify(state))
      })
    } }]
  })
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await server.close()
    if ((await readState())?.instance === instance) await rm(stateFile, { force: true })
    process.exit(0)
  }
  process.once('SIGTERM', close)
  process.once('SIGINT', close)
  await server.listen()
  const address = server.httpServer.address()
  state.url = `http://127.0.0.1:${address.port}`
  const temporary = `${stateFile}.${process.pid}`
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
  const { rename } = await import('node:fs/promises')
  await rename(temporary, stateFile)
  console.log(`UI preview listening at ${state.url}`)
}

async function run() {
  if (!['start', 'status', 'stop', '--serve'].includes(command)) throw new Error('Usage: npm run dev:web -- [start|status|stop] [scenario]')
  if (!scenarios.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}. Choose ${scenarios.join(', ')}.`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (command === '--serve') return serve()
  await acquireLock()
  try {
    const existing = await healthy()
    if (command === 'status') {
      if (existing) printState(existing, true)
      else console.log(JSON.stringify({ status: 'stopped', log: logFile }))
      return
    }
    if (command === 'stop') {
      if (existing) {
        process.kill(existing.pid, 'SIGTERM')
        const deadline = Date.now() + 5000
        while (await healthy()) {
          if (Date.now() > deadline) throw new Error('Preview did not stop within five seconds.')
          await delay(100)
        }
      }
      console.log(JSON.stringify({ status: 'stopped' }))
      return
    }
    if (existing) return printState(existing, true)
    const log = openSync(logFile, 'w', 0o600)
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve'], {
      cwd: root, detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, NODE_ENV: 'development', ELECTRON_RUN_AS_NODE: '1' }
    })
    closeSync(log)
    let failure
    child.once('error', (error) => { failure = error })
    child.unref()
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const state = await healthy()
      if (state) return printState(state, false)
      if (failure || child.exitCode !== null) break
      await delay(100)
    }
    if (child.pid && alive(child.pid)) process.kill(child.pid, 'SIGTERM')
    throw new Error(`Preview startup failed. ${failure?.message ?? ''}\n${(await readFile(logFile, 'utf8')).slice(-6000)}`)
  } finally {
    await rm(lockFile, { force: true })
  }
}

run().catch((error) => { console.error(error.message); process.exitCode = 1 })
