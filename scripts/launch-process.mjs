import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

// Chromium grandchildren can survive their main process. Keep this launch in its own
// POSIX group and retain cleanup ownership even after electron-vite has exited.
export function launchProcess(command, args, options, { graceMs = 7_000 } = {}) {
  const grouped = process.platform !== 'win32'
  const child = spawn(command, args, { ...options, detached: grouped })
  let cleanup
  const signal = (name) => {
    if (!child.pid) return
    try {
      if (grouped) process.kill(-child.pid, name)
      else child.kill(name)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  const alive = () => {
    if (!child.pid) return false
    if (!grouped) return child.exitCode === null && child.signalCode === null
    try { process.kill(-child.pid, 0); return true }
    catch (error) {
      if (error.code === 'ESRCH') return false
      throw error
    }
  }
  const stop = (name = 'SIGTERM') => {
    cleanup ??= (async () => {
      signal(name)
      const deadline = Date.now() + graceMs
      while (alive() && Date.now() < deadline) await delay(Math.min(50, graceMs))
      if (alive()) signal('SIGKILL')
    })()
    return cleanup
  }
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  }).then(async (result) => {
    await stop()
    return result
  })
  return { child, completed, stop }
}
