import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { VERIFY_LEASE_ENV } from './verify-janitor.js'
import { appCheckoutPath } from './app-checkout.js'

export const CLOSEDAI_WORKSPACE_CWD_ENV = 'CLOSEDAI_WORKSPACE_CWD'
export const CLOSEDAI_WORK_LOCK_SCRIPT_ENV = 'CLOSEDAI_WORK_LOCK_SCRIPT'
export const CLOSEDAI_REAL_NPM_ENV = 'CLOSEDAI_REAL_NPM'
export const CLOSEDAI_REAL_NODE_ENV = 'CLOSEDAI_REAL_NODE'

const CLOSEDAI_BIN = join('scripts', 'closedai-bin')

function pathKey(env: NodeJS.ProcessEnv): 'PATH' | 'Path' {
  return 'Path' in env ? 'Path' : 'PATH'
}

function resolveOnPath(name: string, pathEnv: string): string {
  if (process.platform === 'win32') {
    try {
      const lines = execSync(`where ${name}`, { encoding: 'utf8', env: { ...process.env, PATH: pathEnv, Path: pathEnv } })
        .trim()
        .split(/\r?\n/)
      const hit = lines.find((line) => line.trim().length > 0)
      return hit?.trim() || name
    } catch {
      return name
    }
  }
  try {
    return execSync(`command -v ${name}`, { encoding: 'utf8', env: { ...process.env, PATH: pathEnv } }).trim() || name
  } catch {
    return name
  }
}

function workLockScriptPath(checkout: string): string {
  return join(checkout, 'scripts', 'work-lock.mjs')
}

export type ProviderChildEnvInput = {
  workspaceCwd: string
  paneId?: string | null
  workLockEnabled?: boolean
}

/** Env vars and PATH shims so provider shell tools serialize heavy workspace commands. */
export function buildProviderChildEnv(input: ProviderChildEnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  env[CLOSEDAI_WORKSPACE_CWD_ENV] = input.workspaceCwd

  if (input.workLockEnabled === false) return env

  const checkout = appCheckoutPath()
  const shimDir = join(checkout, CLOSEDAI_BIN)
  const key = pathKey(env)
  const existingPath = env[key] ?? ''
  env[CLOSEDAI_REAL_NPM_ENV] = resolveOnPath('npm', existingPath)
  env[CLOSEDAI_REAL_NODE_ENV] = process.execPath
  env[CLOSEDAI_WORK_LOCK_SCRIPT_ENV] = workLockScriptPath(checkout)
  env[key] = `${shimDir}${process.platform === 'win32' ? ';' : ':'}${existingPath}`

  if (input.paneId) {
    env[VERIFY_LEASE_ENV] = `${input.paneId}:${Date.now()}`
  }

  return env
}

/** Test seam: resolve script paths without Electron bootstrap. */
export function providerWorkLockPaths(checkout: string): { shimDir: string; lockScript: string } {
  return {
    shimDir: join(checkout, CLOSEDAI_BIN),
    lockScript: workLockScriptPath(checkout)
  }
}
