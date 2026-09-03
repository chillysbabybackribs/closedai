// Generates the repository index queried by the read-only workspace navigation tool.
// Run with --check in the completion gate and --write to refresh committed data.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'src/main/tools/workspace/workspace-index.generated.ts')
const indexedExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx'])
const ignoredDirectories = new Set(['coverage', 'dist', 'node_modules', 'out'])
const ignoredFiles = new Set(['package-lock.json', 'THIRD_PARTY_NOTICES.md'])
const maxModuleBytes = 45_000

function isTest(name) {
  return /\.test\.tsx?$/.test(name)
}

async function collectFiles(directory = root) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(target))
    else if (
      entry.isFile() &&
      indexedExtensions.has(path.extname(entry.name)) &&
      !ignoredFiles.has(entry.name)
    ) {
      files.push(path.relative(root, target).replaceAll(path.sep, '/'))
    }
  }
  return files
}

// Match registration call sites only. A bare "a:b" literal is not evidence that a file
// owns an IPC namespace.
const handlerPattern = /ipcMain\s*\.\s*(?:handle|handleOnce|on|once)\(\s*['"]([a-zA-Z][a-zA-Z0-9]*):[a-zA-Z][a-zA-Z0-9]*['"]/g
const callerPattern = /ipcRenderer\s*\.\s*(?:invoke|send|on|once)\(\s*['"]([a-zA-Z][a-zA-Z0-9]*):[a-zA-Z][a-zA-Z0-9]*['"]/g

async function namespacesIn(relativePath, pattern) {
  const source = await readFile(path.join(root, relativePath), 'utf8')
  return new Set([...source.matchAll(pattern)].map(([, namespace]) => namespace))
}

async function mainIpcFiles() {
  const found = []
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(target)
      else if (entry.isFile() && entry.name.endsWith('.ts') && !isTest(entry.name)) {
        const relativePath = path.relative(root, target).replaceAll(path.sep, '/')
        const namespaces = await namespacesIn(relativePath, handlerPattern)
        if (namespaces.size > 0) found.push({ file: relativePath, namespaces })
      }
    }
  }
  await walk(path.join(root, 'src/main'))
  return found
}

/** Maps each namespace exposed by preload to the main-process modules that handle it. */
async function ipcFlows() {
  const exposed = await namespacesIn('src/preload/index.ts', callerPattern)
  const handlers = await mainIpcFiles()
  return Object.fromEntries([...exposed].sort().flatMap((namespace) => {
    const owners = handlers
      .filter((handler) => handler.namespaces.has(namespace))
      .map((handler) => handler.file)
      .sort()
    return owners.length > 0 ? [[namespace, owners]] : []
  }))
}

/**
 * Directory areas with the name prefixes that dominate them. These are the rules a reader
 * uses to derive a path instead of searching for it: every file in src/main/claude is
 * claude-*, so "the Claude stream parser" resolves without a lookup.
 */
function areas(files) {
  const byDirectory = new Map()
  for (const file of files) {
    const directory = path.posix.dirname(file)
    if (!byDirectory.has(directory)) byDirectory.set(directory, [])
    byDirectory.get(directory).push(path.posix.basename(file))
  }
  return [...byDirectory.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([directory, names]) => {
    const counts = new Map()
    for (const name of names) {
      const stem = name.replace(/\.[^.]+$/, '').replace(/\.test$/, '')
      const prefix = stem.includes('-') ? stem.slice(0, stem.indexOf('-')) : null
      if (prefix) counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
    }
    const prefixes = names.length >= 6
      ? [...counts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4)
      : []
    // A small directory is cheaper to name outright than to leave as a count the reader
    // then has to go look up; this is what turns "styles/trace/" into "styles/trace/modal.css".
    const listed = names.length <= 2 ? names.slice().sort() : []
    return { directory, files: names.length, prefixes: prefixes.map(([prefix, count]) => [`${prefix}-*`, count]), listed }
  })
}

/** `data-ui` id families mapped to the files that render them, busiest first. */
async function controlFamilies(files) {
  const byFamily = new Map()
  for (const file of files.filter((entry) => /\.tsx?$/.test(entry) && !isTest(entry))) {
    const source = await readFile(path.join(root, file), 'utf8')
    for (const [, id] of source.matchAll(/data-ui="([a-z][a-zA-Z0-9]*)\.[^"]+"/g)) {
      if (!byFamily.has(id)) byFamily.set(id, new Map())
      const owners = byFamily.get(id)
      owners.set(file, (owners.get(file) ?? 0) + 1)
    }
  }
  return Object.fromEntries([...byFamily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([family, owners]) => [
    family,
    // Exhaustive on purpose: a truncated list reads as complete and is acted on as complete,
    // which is the one failure mode a map has that a search does not.
    [...owners.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([file]) => file)
  ]))
}

const files = (await collectFiles()).sort()
const flows = await ipcFlows()
const repositoryAreas = areas(files)
const families = await controlFamilies(files)
const module = `// GENERATED by scripts/repo-tree.mjs — do not edit. Run \`npm run map\` to refresh.
/** Absolute checkout described by this index. */
export const WORKSPACE_INDEX_ROOT = ${JSON.stringify(root)}

/** Navigable repository files. Test files remain data and are omitted only at query time. */
export const WORKSPACE_FILES = ${JSON.stringify(files)} as const

/** Preload IPC namespace -> main-process owner modules. */
export const WORKSPACE_IPC_FLOWS = ${JSON.stringify(flows)} as const

/** Directory areas with the file-name prefixes that dominate them. */
export const WORKSPACE_AREAS = ${JSON.stringify(repositoryAreas)} as const

/** \`data-ui\` id family -> the files that render it, busiest first. */
export const WORKSPACE_CONTROL_FAMILIES = ${JSON.stringify(families)} as const
`

if (Buffer.byteLength(module) > maxModuleBytes) {
  console.error(`✗ workspace index is ${Buffer.byteLength(module)} bytes, above ${maxModuleBytes}`)
  process.exit(1)
}

const mode = process.argv[2] ?? '--write'
const current = await readFile(output, 'utf8').catch(() => null)

if (mode === '--check') {
  if (current === module) {
    console.log(`✓ workspace index current (${files.length} files, ${repositoryAreas.length} areas, ${Object.keys(families).length} control families)`)
  } else {
    console.error('✗ workspace index is stale; run `npm run map`')
    process.exit(1)
  }
} else {
  if (current !== module) await writeFile(output, module)
  const bytes = (await stat(output)).size
  console.log(`workspace index: ${files.length} files, ${repositoryAreas.length} areas, ${Object.keys(families).length} control families, ${bytes} bytes`)
}
