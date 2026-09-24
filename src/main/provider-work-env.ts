import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { VERIFY_LEASE_ENV } from './verify-janitor.js'
import { appCheckoutPath } from './app-checkout.js'

export const CLOSEDAI_WORKSPACE_CWD_ENV = 'CLOSEDAI_WORKSPACE_CWD'
export const CLOSEDAI_WORK_LOCK_SCRIPT_ENV = 'CLOSEDAI_WORK_LOCK_SCRIPT'
export const CLOSEDAI_REAL_NPM_ENV = 'CLOSEDAI_REAL_NPM'
export const CLOSEDAI_REAL_NODE_ENV = 'CLOSEDAI_REAL_NODE'
export const CLOSEDAI_SHIM_BIN_DIR_ENV = 'CLOSEDAI_SHIM_BIN_DIR'

const CLOSEDAI_BIN = join('scripts', 'closedai-bin')

type ResolvedPaths = { realNpm: string; realNode: string; shimDir: string; lockScript: string }

let cachedPaths: { pathKey: string; paths: ResolvedPaths } | null = null

function pathKey(env: NodeJS.ProcessEnv): 'PATH' | 'Path' {
  return 'Path' in env ? 'Path' : 'PATH'
}

function resolveOnPath(name: string, pathEnv: string): string {
  if (process.platform === 'win32') {
    try {
      const lines = execSync(`where ${name}`, {
        encoding: 'utf8',
        env: { ...process.env, PATH: pathEnv, Path: pathEnv }
      }).trim().split(/\r?\n/)
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

function resolvePaths(checkout: string, existingPath: string): ResolvedPaths {
  const cacheKey = `${checkout}\0${existingPath}`
  if (cachedPaths?.pathKey === cacheKey) return cachedPaths.paths
  const paths: ResolvedPaths = {
    realNpm: resolveOnPath('npm', existingPath),
    realNode: resolveOnPath('node', existingPath),
    shimDir: join(checkout, CLOSEDAI_BIN),
    lockScript: join(checkout, 'scripts', 'work-lock.mjs')
  }
  cachedPaths = { pathKey: cacheKey, paths }
  return paths
}

/** @internal */
export function resetProviderWorkEnvCacheForTests(): void {
  cachedPaths = null
}

export type ProviderChildEnvInput = {
  workspaceCwd: string
  paneId?: string | null
  workLockEnabled?: boolean
}

/** Env vars and an npm PATH shim so provider shells serialize heavy workspace commands. */
export function buildProviderChildEnv(input: ProviderChildEnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  env[CLOSEDAI_WORKSPACE_CWD_ENV] = input.workspaceCwd

  if (input.workLockEnabled === false) {
    delete env[CLOSEDAI_WORK_LOCK_SCRIPT_ENV]
    delete env[CLOSEDAI_SHIM_BIN_DIR_ENV]
    delete env[CLOSEDAI_REAL_NPM_ENV]
    delete env[CLOSEDAI_REAL_NODE_ENV]
    return env
  }

  const checkout = appCheckoutPath()
  const key = pathKey(env)
  const existingPath = env[key] ?? ''
  const paths = resolvePaths(checkout, existingPath)
  env[CLOSEDAI_REAL_NPM_ENV] = paths.realNpm
  env[CLOSEDAI_REAL_NODE_ENV] = paths.realNode
  env[CLOSEDAI_WORK_LOCK_SCRIPT_ENV] = paths.lockScript
  env[CLOSEDAI_SHIM_BIN_DIR_ENV] = paths.shimDir
  // Only `npm` is shimmed. A `node` shim on PATH breaks `#!/usr/bin/env node` and adds an extra
  // hop for every MCP/tool subprocess; heavy `node scripts/…` can use npm run or manual work-lock.
  env[key] = `${paths.shimDir}${process.platform === 'win32' ? ';' : ':'}${existingPath}`

  if (input.paneId) {
    env[VERIFY_LEASE_ENV] = `${input.paneId}:${Date.now()}`
  }

  return env
}

/** Test seam: resolve script paths without Electron bootstrap. */
export function providerWorkLockPaths(checkout: string): { shimDir: string; lockScript: string } {
  return {
    shimDir: join(checkout, CLOSEDAI_BIN),
    lockScript: join(checkout, 'scripts', 'work-lock.mjs')
  }
}
