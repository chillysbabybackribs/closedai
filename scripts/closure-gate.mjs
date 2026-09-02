// Import-closure gate: walks every static/dynamic import from the three entry points and
// fails when anything outside the allowlist is reachable. This is what keeps closedai to
// "only what is needed" — a stray import of agent/provider/tool code fails the build.
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entries = ['src/main/index.ts', 'src/preload/index.ts', 'src/renderer/App.tsx']
const allowedPackages = new Set([
  'electron', 'react', 'react-dom', 'lucide-react', 'clsx', 'tailwind-merge',
  'class-variance-authority', 'radix-ui', 'react-resizable-panels',
  'marked', 'react-markdown', 'remark-breaks', 'remark-gfm', 'shiki', 'use-stick-to-bottom',
  '@shadcn/react',
  '@fontsource-variable/inter', '@fontsource-variable/geist-mono', '@fontsource/instrument-serif',
  // The Claude Code provider: the Agent SDK (loaded lazily, externalized from the bundle) and
  // zod, which its in-process MCP tool helper takes tool schemas in.
  '@anthropic-ai/claude-agent-sdk', 'zod'
])
const forbiddenPaths = /(claude|codex|cursor|antigravity|agent|mcp|tool-|plugin|recall|artifact|seo-|blender|ytdlp|vpn|tor-|workflow|credential)/i
// The sanctioned homes for model-facing tools (docs/tools.md): the registry in main and
// its inspector UI in the renderer, plus the Claude Code provider adapter (docs/claude-code.md).
// Everything else that smells like agent/provider/tool code is still rejected.
const sanctionedPaths = /^src\/(main|renderer)\/tools\/|^src\/main\/claude\//

const importRe = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
function resolveLocal(from, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null
  const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : resolve(dirname(from), spec)
  for (const c of [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}
const seen = new Set(); const packages = new Set(); const problems = []
const stack = entries.map((e) => resolve(root, e))
while (stack.length) {
  const file = stack.pop()
  if (seen.has(file)) continue
  seen.add(file)
  const rel = relative(root, file)
  if (forbiddenPaths.test(rel) && !sanctionedPaths.test(rel)) problems.push(`forbidden module reachable: ${rel}`)
  if (!/\.(ts|tsx)$/.test(file)) continue
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(importRe)) {
    const spec = match[1] ?? match[2]
    const local = resolveLocal(file, spec)
    if (local) { stack.push(local); continue }
    if (spec.startsWith('.') || spec.startsWith('node:')) continue
    if (/\.css$/.test(spec)) continue
    const pkg = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')
    packages.add(pkg)
    if (!allowedPackages.has(pkg)) problems.push(`package not allowlisted: ${pkg} (from ${rel})`)
  }
}
let lines = 0
for (const f of seen) lines += readFileSync(f, 'utf8').split('\n').length
console.log(`closure: ${seen.size} files, ${lines} lines; packages: ${[...packages].sort().join(', ')}`)
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`)
  process.exit(1)
}
console.log('✓ closure gate passed')
