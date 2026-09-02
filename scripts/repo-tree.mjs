// Generates the workspace map injected into Codex thread instructions.
// Everything here is derived from the filesystem and from IPC channel literals, so the map
// cannot drift from the code. Run with --check in the completion gate, --write to refresh.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'src/main/chat-context/workspace-map.generated.ts')
const sourceExtensions = new Set(['.ts', '.tsx'])
// Past this many files a directory is listed as filename-prefix families instead of members,
// so the map stays a fixed cost as the codebase grows.
const collapseAbove = 40
// The generated module is checked by the hygiene gate as ordinary code (450 lines).
const maxRenderedLines = 380

function isTest(name) {
  return /\.test\.tsx?$/.test(name)
}

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  const directories = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    if (entry.isDirectory()) directories.push(await collect(path.join(directory, entry.name)))
    else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(entry.name)
  }
  return {
    path: path.relative(root, directory).replaceAll(path.sep, '/'),
    sources: files.filter((name) => !isTest(name)).sort(),
    tests: new Set(files.filter(isTest)),
    directories: directories.filter((child) => child.sources.length > 0 || child.directories.length > 0)
  }
}

/** A source file is marked when a sibling test covers it, so test gaps are visible in place. */
function hasTest(node, name) {
  const base = name.replace(/\.tsx?$/, '')
  return node.tests.has(`${base}.test.ts`) || node.tests.has(`${base}.test.tsx`)
}

function familiesOf(names) {
  const families = new Map()
  for (const name of names) {
    const key = name.includes('-') ? `${name.slice(0, name.indexOf('-'))}-*` : name
    families.set(key, (families.get(key) ?? 0) + 1)
  }
  return [...families].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function renderTree(node, lines = []) {
  if (node.sources.length > 0 || node.directories.length === 0) lines.push(`${node.path}/`)
  if (node.sources.length > collapseAbove) {
    for (const [family, count] of familiesOf(node.sources)) {
      lines.push(count > 1 ? `  ${family}  (${count} files)` : `  ${family}`)
    }
  } else {
    for (const name of node.sources) lines.push(`  ${name}${hasTest(node, name) ? ' *' : ''}`)
  }
  for (const child of node.directories) renderTree(child, lines)
  return lines
}

const channelPattern = /['"]([a-zA-Z][a-zA-Z0-9]*):([a-zA-Z][a-zA-Z0-9]*)['"]/g

async function channelsIn(relativePath) {
  const source = await readFile(path.join(root, relativePath), 'utf8')
  const namespaces = new Set()
  for (const [, namespace] of source.matchAll(channelPattern)) namespaces.add(namespace)
  return namespaces
}

async function mainIpcFiles() {
  const found = []
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(target)
      else if (entry.isFile() && entry.name.endsWith('.ts') && !isTest(entry.name)) {
        const source = await readFile(target, 'utf8')
        if (!source.includes('ipcMain.')) continue
        const relativePath = path.relative(root, target).replaceAll(path.sep, '/')
        found.push({ file: relativePath, namespaces: await channelsIn(relativePath) })
      }
    }
  }
  await walk(path.join(root, 'src/main'))
  return found
}

/** Pairs each preload namespace with the main-process module that handles its channels. */
async function renderFlows() {
  const preload = 'src/preload/index.ts'
  const exposed = await channelsIn(preload)
  const handlers = await mainIpcFiles()
  const rows = []
  for (const namespace of [...exposed].sort()) {
    const owners = handlers
      .filter((handler) => handler.namespaces.has(namespace))
      .map((handler) => handler.file.replace(/^src\//, ''))
      .sort()
    if (owners.length > 0) rows.push([`${namespace}:*`, owners.join(', ')])
  }
  const width = Math.max(...rows.map(([channel]) => channel.length))
  return rows.map(([channel, owners]) => `  ${channel.padEnd(width)}  ->  ${owners}`)
}

function render(tree, flows) {
  return [
    'Workspace: closedai — Electron shell (main + preload + renderer) wrapping the Codex',
    'app-server, with an embedded Chromium browser.',
    '',
    'Dependencies point one way: renderer and components -> shared <- preload <- main.',
    'src/shared holds dependency-free contracts; src/shared/api.ts is the whole preload surface.',
    'Enforced by scripts/hygiene-gate.mjs, which also caps files at 300 lines (.tsx) / 450 (.ts).',
    '',
    'Source files below, tests omitted. A trailing * means a sibling *.test.ts covers that file.',
    '',
    ...tree,
    '',
    'Renderer calls window.closedai.<namespace> in src/preload/index.ts, which forwards these',
    'IPC channels to the main-process modules that own them:',
    '',
    ...flows,
    '',
    'To locate code: rg -n \'<symbol>\' src, then read only that line range.'
  ].join('\n')
}

const tree = renderTree(await collect(path.join(root, 'src')))
const flows = await renderFlows()
const map = render(tree, flows)
const rendered = map.split('\n').length

const module = `// GENERATED by scripts/repo-tree.mjs — do not edit. Run \`npm run map\` to refresh.
/** Absolute path this map describes; injection is skipped for any other workspace. */
export const WORKSPACE_MAP_ROOT = ${JSON.stringify(root)}

export const WORKSPACE_MAP = ${JSON.stringify(map)}
`

if (rendered > maxRenderedLines) {
  console.error(`✗ map is ${rendered} lines, above ${maxRenderedLines}; lower collapseAbove in scripts/repo-tree.mjs`)
  process.exit(1)
}

const mode = process.argv[2] ?? '--write'
const current = await readFile(output, 'utf8').catch(() => null)

if (mode === '--check') {
  if (current === module) {
    console.log(`✓ workspace map current (${rendered} lines, ${map.length} chars)`)
  } else {
    console.error('✗ workspace map is stale; run `npm run map`')
    process.exit(1)
  }
} else {
  if (current !== module) await writeFile(output, module)
  const bytes = (await stat(output)).size
  console.log(`map: ${rendered} lines, ${map.length} chars (~${Math.round(map.length / 4)} tokens), module ${bytes} bytes`)
}
