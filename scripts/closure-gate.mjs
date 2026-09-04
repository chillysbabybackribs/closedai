// Import-closure gate: walks every static/dynamic import from the three entry points and
// fails when anything outside the allowlist is reachable, or when a source file under src/
// is reachable from nothing. This is what keeps closedai to "only what is needed" — a stray
// import of agent/provider/tool code fails the build, and so does code nothing imports.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
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
  '@anthropic-ai/claude-agent-sdk', 'zod',
  // The Antigravity provider serves the tool registry to the `agy` CLI over MCP (docs/antigravity.md).
  '@modelcontextprotocol/sdk'
])
// `tor-` is anchored to a path-segment or word boundary: unanchored it also matches the tail of
// "inspector-modal", which rejected a sanctioned UI file for containing the letters t-o-r.
const forbiddenPaths = /(claude|codex|cursor|antigravity|agent|mcp|tool-|plugin|recall|artifact|seo-|blender|ytdlp|vpn|(?:^|[/-])tor-|workflow|credential)/i
// The sanctioned homes for model-facing tools (docs/tools.md): the registry in main and
// its inspector UI in the renderer, plus the Claude Code provider adapter (docs/claude-code.md),
// the Antigravity provider adapter (docs/antigravity.md), and the Cursor provider adapter
// (docs/cursor.md), plus the transcript memory the `peer_chats` recall and checkpoint tools read.
// Everything else that smells like agent/provider/tool code is still rejected.
const sanctionedPaths =
  /^src\/(main|renderer)\/tools\/|^src\/main\/(claude|antigravity|cursor)\/|^src\/main\/chat-context\/memory-/

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
  // Stylesheets carry no imports of their own beyond other stylesheets, so a feature name in
  // a sheet's path (agents.css, tool-activity.css) is not the module smell this rejects.
  const isStyle = file.endsWith('.css')
  if (!isStyle && forbiddenPaths.test(rel) && !sanctionedPaths.test(rel)) problems.push(`forbidden module reachable: ${rel}`)
  if (!/\.(ts|tsx|css)$/.test(file)) continue
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(importRe)) {
    const spec = match[1] ?? match[2]
    const local = resolveLocal(file, spec)
    if (local) { stack.push(local); continue }
    // A stylesheet's `@import` of a package (tailwindcss, a font face) is a bundler concern,
    // not part of the module closure this gate polices.
    if (isStyle) continue
    if (spec.startsWith('.') || spec.startsWith('node:')) continue
    if (/\.css$/.test(spec)) continue
    const pkg = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')
    packages.add(pkg)
    if (!allowedPackages.has(pkg)) problems.push(`package not allowlisted: ${pkg} (from ${rel})`)
  }
}
// The other half of "only what is needed": a file no entry point can reach is dead weight,
// and dead renderer files keep advertising `data-ui` ids the manifest guard still counts as
// rendered. Tests and ambient declarations are reached by the test runner and tsc instead.
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (/\.test\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) return []
    return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : []
  })
}
function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return testFiles(path)
    return /\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}
// A module only the tests import — a shared harness of doubles — is reached by the test runner
// just as the tests themselves are, so it is not dead weight. Its reachability is computed from
// the test files separately, and ONLY for this check: the forbidden-path and package rules above
// stay bound to the entry-point closure, so a test still cannot smuggle anything into the app.
const reachedByTests = new Set()
const testStack = testFiles(join(root, 'src'))
while (testStack.length) {
  const file = testStack.pop()
  if (reachedByTests.has(file)) continue
  reachedByTests.add(file)
  if (file.endsWith('.css')) continue
  for (const match of readFileSync(file, 'utf8').matchAll(importRe)) {
    const local = resolveLocal(file, match[1] ?? match[2])
    if (local) testStack.push(local)
  }
}
for (const file of sourceFiles(join(root, 'src'))) {
  if (!seen.has(file) && !reachedByTests.has(file)) problems.push(`unreachable source file: ${relative(root, file)}`)
}

let lines = 0
for (const f of seen) lines += readFileSync(f, 'utf8').split('\n').length
console.log(`closure: ${seen.size} files, ${lines} lines; packages: ${[...packages].sort().join(', ')}`)
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`)
  process.exit(1)
}
console.log('✓ closure gate passed')
