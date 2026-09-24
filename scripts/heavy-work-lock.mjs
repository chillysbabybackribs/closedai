/**
 * Heuristic for shell commands that should serialize through work-lock per workspace.
 * Used by scripts/closedai-bin shims; keep behavior aligned with docs/application.md.
 */

const HEAVY_NPM_SCRIPTS = new Set([
  'build',
  'check',
  'test',
  'hygiene',
  'preview',
  'closure',
  'browser:live',
  'search:pipeline',
  'harness:replay',
  'harness:model',
  'harness:compare',
  'harness:codex',
  'harness:prompt-sweep',
  'harness:live',
  'map',
  'map:check',
  'guide:check'
])

function basename(token) {
  const slash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'))
  return slash >= 0 ? token.slice(slash + 1) : token
}

function npmRunScript(args) {
  const runIndex = args.findIndex((token) => token === 'run')
  if (runIndex >= 0 && args[runIndex + 1]) return args[runIndex + 1]
  return null
}

function npmInvocationHeavy(args) {
  if (args.includes('test')) return true
  const script = npmRunScript(args)
  if (script && HEAVY_NPM_SCRIPTS.has(script)) return true
  if (script?.startsWith('harness:')) return true
  return false
}

function nodeInvocationHeavy(args) {
  const script = args.find((token) => typeof token === 'string' && token.includes('scripts/'))
  if (!script) {
    if (args.includes('--test')) {
      const target = args.find((token) => token.includes('src/') || token.includes('**'))
      return Boolean(target)
    }
    return false
  }
  if (script.includes('work-lock.mjs')) return false
  if (script.includes('-live-check') || script.includes('-live-electron')) return true
  if (script.includes('harness-sim/') || script.includes('harness-sim\\')) return true
  if (script.includes('hygiene-gate') || script.includes('closure-gate')) return true
  if (script.includes('launch-electron-vite')) return true
  return false
}

/** @param {string[]} argv command name + args (no node path) */
export function isHeavyWorkspaceCommand(argv) {
  const tokens = argv.filter((token) => token.length > 0)
  if (tokens.length === 0) return false
  const joined = tokens.join(' ')
  if (joined.includes('work-lock.mjs')) return false

  const head = basename(tokens[0]).toLowerCase()
  const rest = tokens.slice(1)
  if (head === 'npm' || head === 'npm.cmd') return npmInvocationHeavy(rest)
  if (head === 'node' || head === 'node.exe') return nodeInvocationHeavy(rest)
  if (head === 'electron-vite') return rest[0] === 'build'
  return false
}
