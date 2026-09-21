#!/usr/bin/env node
// Launches electron-vite with a GPU-safe environment, and exports the sanitizer so the
// other launch path (dev-with-autogit.mjs) applies the same rule.
//
// Why this wrapper exists: on hybrid-GPU Linux machines (NVIDIA Optimus/PRIME offload),
// a shell that carries the dGPU offload variables forces Chromium's ANGLE onto NVIDIA's
// EGL while the X screen's visuals belong to the other GPU. eglInitialize then fails with
// `ANGLE Display::initialize error 12289: Invalid visual ID requested`, both EGL display
// types fail, the GPU process exits, and Electron silently restarts it with
// `--use-gl=disabled` + `--disable-gpu-compositing`. The app keeps working but every pixel
// — including three.js artifacts, browser_capture video, and the whole renderer — is
// rasterized on the CPU.
//
// It has to happen here, not in src/main: Chromium snapshots the environment before
// Electron's JS runs, so deleting these in the main process does NOT reach the GPU child
// (verified — the ANGLE errors persist). They must be gone before the electron binary is
// exec'd.
//
// Escape hatch: set CLOSEDAI_KEEP_GL_VENDOR=1 to keep the offload vars, e.g. to run WebGL
// on the dGPU with `--use-angle=vulkan`. That combination renders WebGL on NVIDIA but
// reports gpu_compositing=disabled_software and webgl=enabled_readback, so UI compositing
// stays on the CPU; the sanitized default gets full hardware compositing + WebGL on the
// GPU that actually drives the display.
//
// The Chromium sandbox is on by default. CLOSEDAI_NO_SANDBOX=1 is the one machine-specific
// opt-out (a kernel that forbids unprivileged user namespaces with a non-SUID chrome-sandbox
// helper); only then is Electron's own ELECTRON_DISABLE_SANDBOX exported, and only to this child.
import { spawn } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRIME_OFFLOAD_VARS = ['__NV_PRIME_RENDER_OFFLOAD', '__GLX_VENDOR_LIBRARY_NAME', '__VK_LAYER_NV_optimus']
// A parent Electron app (a terminal or agent running inside one) exports its own binary and
// identity to children; electron-vite honours ELECTRON_EXEC_PATH, so without this scrub the
// app launches on the PARENT's Electron instead of the version installed here.
const HOST_ELECTRON_VARS = ['ELECTRON_EXEC_PATH', 'ELECTRON_CLI_ARGS', 'ELECTRON_MAJOR_VER', 'ELECTRON_PA_APP_NAME', 'ELECTRON_RUN_AS_NODE']

/**
 * Removes GL vendor forcing that breaks ANGLE on hybrid-GPU Linux sessions.
 * Returns a copy of the environment plus the names that were dropped (for logging).
 */
export function sanitizeGpuEnv(env = process.env) {
  if (process.platform !== 'linux' || env.CLOSEDAI_KEEP_GL_VENDOR === '1') return { env, removed: [] }
  const removed = PRIME_OFFLOAD_VARS.filter((name) => env[name] !== undefined)
  if (removed.length === 0) return { env, removed }
  const next = { ...env }
  for (const name of removed) delete next[name]
  return { env: next, removed }
}

/**
 * A checkout launch that would abort before app code runs: the kernel forbids unprivileged
 * user namespaces and the npm-installed chrome-sandbox helper is not root-owned SUID (it never is
 * after `npm install`). A packaged build installs the helper correctly, so this only concerns
 * running from the repository. Returns the reason, or null when the sandbox can start.
 */
export function sandboxBlockedReason(repoRoot, { platform = process.platform, statSync, readFileSync } = {}) {
  if (platform !== 'linux') return null
  try {
    const restricted = readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1'
    if (!restricted) return null
    const helper = statSync(join(repoRoot, 'node_modules', 'electron', 'dist', 'chrome-sandbox'))
    const suidRoot = helper.uid === 0 && (helper.mode & 0o4000) !== 0
    return suidRoot ? null : 'this kernel restricts unprivileged user namespaces and node_modules/electron/dist/chrome-sandbox is not root-owned SUID'
  } catch {
    return null
  }
}

/**
 * Electron's sandbox variable follows the app's own opt-out (CLOSEDAI_NO_SANDBOX=1), or the
 * detected checkout condition above, and is never set otherwise.
 */
export function sandboxEnv(env = process.env, blockedReason = null, stream = process.stderr) {
  const next = { ...env }
  delete next.ELECTRON_DISABLE_SANDBOX
  if (env.CLOSEDAI_NO_SANDBOX === '1') {
    next.ELECTRON_DISABLE_SANDBOX = '1'
  } else if (blockedReason) {
    next.ELECTRON_DISABLE_SANDBOX = '1'
    stream.write(
      `[launch] running this checkout without the Chromium sandbox: ${blockedReason}.\n` +
      '[launch] one-time fix: sudo chown root:root node_modules/electron/dist/chrome-sandbox && ' +
      'sudo chmod 4755 node_modules/electron/dist/chrome-sandbox (repeat after reinstalling electron)\n'
    )
  }
  return next
}

export function reportSanitizedGpuEnv(removed, stream = process.stderr) {
  if (removed.length === 0) return
  stream.write(
    `[launch] dropped ${removed.join(', ')} so Chromium's ANGLE can initialize on the display GPU ` +
      `(set CLOSEDAI_KEEP_GL_VENDOR=1 to keep them)\n`
  )
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const binExtension = process.platform === 'win32' ? '.cmd' : ''
  const { env: gpuEnv, removed } = sanitizeGpuEnv()
  reportSanitizedGpuEnv(removed)
  const env = sandboxEnv(gpuEnv, sandboxBlockedReason(repoRoot, { statSync, readFileSync }))
  for (const name of HOST_ELECTRON_VARS) delete env[name]
  const child = spawn(join(repoRoot, 'node_modules', '.bin', `electron-vite${binExtension}`), process.argv.slice(2), {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  })
  child.on('error', (error) => {
    process.stderr.write(`[launch] failed to start electron-vite: ${error.message}\n`)
    process.exit(1)
  })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 0)
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      if (child.exitCode === null && !child.killed) child.kill(signal)
    })
  }
}
