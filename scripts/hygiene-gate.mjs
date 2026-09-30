import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scanRoots = ['src', 'scripts']
const thresholds = {
  component: { lines: 450, bytes: 60_000 },
  code: { lines: 675, bytes: 60_000 },
  test: { lines: 525, bytes: 60_000 },
  style: { lines: 675, bytes: 75_000 },
  script: { lines: 450, bytes: 52_500 },
  data: { lines: 375, bytes: 45_000 }
}
const checkedExtensions = new Set(['.ts', '.tsx', '.css', '.mjs', '.json'])
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'dist') continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(target))
    else if (entry.isFile() && checkedExtensions.has(path.extname(entry.name))) files.push(target)
  }
  return files
}

function categoryFor(relativePath) {
  if (/\.test\.tsx?$/.test(relativePath)) return 'test'
  if (relativePath.endsWith('.tsx')) return 'component'
  if (relativePath.endsWith('.css')) return 'style'
  if (relativePath.endsWith('.mjs')) return 'script'
  if (relativePath.endsWith('.json')) return 'data'
  return 'code'
}

function sourceLayer(relativePath) {
  return relativePath.match(/^src\/(main|preload|renderer|shared|components)(?:\/|$)/)?.[1] ?? null
}

function resolveImport(fromFile, specifier) {
  if (specifier.startsWith('@/')) return path.join(root, 'src', specifier.slice(2))
  if (specifier.startsWith('.')) return path.resolve(path.dirname(fromFile), specifier)
  return null
}

function boundaryProblem(fromRelative, targetPath) {
  const from = sourceLayer(fromRelative)
  const target = sourceLayer(path.relative(root, targetPath).replaceAll(path.sep, '/'))
  if (!from || !target || from === target) return null
  if (from === 'shared' && target !== 'shared') return 'shared code must not depend on an application layer'
  if (from === 'renderer' && (target === 'main' || target === 'preload')) return 'renderer code must use the preload API, not backend modules'
  if (from === 'main' && (target === 'renderer' || target === 'components')) return 'main-process code must not depend on UI modules'
  if (from === 'preload' && (target === 'main' || target === 'renderer' || target === 'components')) return 'preload may only depend on shared contracts'
  if (from === 'components' && (target === 'main' || target === 'preload')) return 'UI primitives must stay backend-agnostic'
  return null
}

const files = (await Promise.all(scanRoots.map((entry) => walk(path.join(root, entry))))).flat()
const problems = []
const sizeAdvisories = []

for (const file of files) {
  const relativePath = path.relative(root, file).replaceAll(path.sep, '/')
  const source = await readFile(file, 'utf8')
  const bytes = (await stat(file)).size
  const lines = source === '' ? 0 : source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0)
  const category = categoryFor(relativePath)
  const threshold = thresholds[category]
  const measurements = []
  if (lines > threshold.lines) measurements.push(`${lines}/${threshold.lines} lines`)
  if (bytes > threshold.bytes) measurements.push(`${bytes}/${threshold.bytes} bytes`)
  if (measurements.length) sizeAdvisories.push(`${relativePath}: ${measurements.join(', ')}`)

  if (!relativePath.endsWith('.ts') && !relativePath.endsWith('.tsx')) continue
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2]
    const target = resolveImport(file, specifier)
    if (!target) continue
    const issue = boundaryProblem(relativePath, target)
    if (issue) problems.push(`${relativePath}: ${issue} (${specifier})`)
  }
}

console.log(`hygiene: checked ${files.length} source files`)
if (sizeAdvisories.length) {
  console.log(`Size advisory: ${sizeAdvisories.length} files exceed review thresholds (non-blocking).`)
  if (process.argv.includes('--details')) {
    for (const advisory of sizeAdvisories) console.log(`  • ${advisory}`)
  }
  console.log('Use cohesion and maintenance cost to choose whether to extend, extract, or simplify; no size-only refactor required.')
}
if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`)
  console.error('Fix dependency boundaries before continuing.')
  process.exit(1)
}
console.log('✓ hygiene architecture checks passed')
