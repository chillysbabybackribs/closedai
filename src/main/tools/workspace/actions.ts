import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  WORKSPACE_FILES,
  WORKSPACE_IPC_FLOWS
} from '../../chat-context/workspace-index.generated.js'
import type { ToolAction } from '../action-tool.js'
import { booleanArg, numberArg, stringArg, textResult } from '../tool.js'

const indexedFiles: readonly string[] = WORKSPACE_FILES
const fileSet = new Set<string>(indexedFiles)
const ipcFlows: Readonly<Record<string, readonly string[]>> = WORKSPACE_IPC_FLOWS
const testPattern = /\.test\.tsx?$/
const codePattern = /\.(?:js|mjs|ts|tsx)$/
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
const pathField = {
  type: 'string',
  minLength: 1,
  description: 'Repository-relative file or directory path.'
}

function inputSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

function cleanPath(raw: string): string {
  const unix = raw.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (!unix || unix === '.') return ''
  if (path.posix.isAbsolute(unix) || unix.split('/').includes('..')) {
    throw new Error('`path` must stay inside the indexed workspace')
  }
  return path.posix.normalize(unix)
}

function isSiblingTest(source: string, candidate: string): boolean {
  const base = source.replace(/\.(?:js|mjs|ts|tsx)$/, '')
  return candidate === `${base}.test.ts` || candidate === `${base}.test.tsx`
}

function siblingTests(source: string): string[] {
  return indexedFiles.filter((candidate) => isSiblingTest(source, candidate))
}

function mapAction(): ToolAction {
  return {
    action: 'map',
    description:
      'List a bounded slice of the generated repository index. Tests are omitted by default; ' +
      '"[sibling test]" means only that a same-basename test file exists.',
    inputSchema: inputSchema({
      path: pathField,
      depth: { type: 'integer', minimum: 0, maximum: 5, description: 'Directory levels below the requested path; default 2.' },
      include_tests: { type: 'boolean', description: 'Include test files; default false.' },
      max_results: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum files; default 80.' }
    }),
    async run(input) {
      const scope = cleanPath(stringArg(input, 'path', 'src') ?? 'src')
      const depth = numberArg(input, 'depth', 2)
      const includeTests = booleanArg(input, 'include_tests', false)
      const maxResults = numberArg(input, 'max_results', 80)
      const prefix = scope ? `${scope}/` : ''
      const candidates = fileSet.has(scope)
        ? [scope]
        : indexedFiles.filter((file) => file.startsWith(prefix) && file.slice(prefix.length).split('/').length - 1 <= depth)
      const visible = candidates.filter((file) => includeTests || !testPattern.test(file))
      if (visible.length === 0) throw new Error(`no indexed files match ${JSON.stringify(scope || '.')}`)
      const shown = visible.slice(0, maxResults)
      const lines = shown.map((file) => `${file}${siblingTests(file).length ? ' [sibling test]' : ''}`)
      const omitted = visible.length - shown.length
      const header = `Workspace map: ${scope || '.'} (depth ${depth}; ${includeTests ? 'tests included' : 'tests omitted'})`
      const footer = omitted > 0 ? `\n[${omitted} more files omitted; narrow path or raise max_results]` : ''
      return textResult(`${header}\n\n${lines.join('\n')}${footer}`)
    }
  }
}

function importCandidates(base: string): string[] {
  const withoutJs = base.replace(/\.(?:js|mjs)$/, '')
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`
  ]
}

function resolveImport(from: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`
  else if (specifier.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
  else return null
  return importCandidates(base).find((candidate) => fileSet.has(candidate)) ?? null
}

async function importsOf(root: string, file: string): Promise<string[]> {
  if (!codePattern.test(file)) return []
  const source = await readFile(path.join(root, file), 'utf8')
  return [...new Set([...source.matchAll(importPattern)].flatMap((match) => {
    const resolved = resolveImport(file, match[1] ?? match[2])
    return resolved ? [resolved] : []
  }))].sort()
}

async function importersOf(root: string, target: string, testsOnly = false): Promise<string[]> {
  const candidates = indexedFiles.filter((file) => codePattern.test(file) && (!testsOnly || testPattern.test(file)))
  const imports = await Promise.all(candidates.map(async (file) => [file, await importsOf(root, file)] as const))
  return imports.filter(([, dependencies]) => dependencies.includes(target)).map(([file]) => file).sort()
}

function section(title: string, files: readonly string[]): string {
  return `${title}:\n${files.length ? files.slice(0, 40).map((file) => `  ${file}`).join('\n') : '  (none)'}`
}

function relatedAction(root: string): ToolAction {
  return {
    action: 'related',
    description:
      'For one indexed file, show its direct relative imports, direct importers, and same-basename tests. ' +
      'Package imports and transitive relationships are intentionally omitted.',
    inputSchema: inputSchema({ path: pathField }, ['path']),
    async run(input) {
      const file = cleanPath(stringArg(input, 'path') ?? '')
      if (!fileSet.has(file)) throw new Error(`${JSON.stringify(file)} is not an indexed file`)
      const [imports, importers] = await Promise.all([importsOf(root, file), importersOf(root, file)])
      return textResult([
        `Related files for ${file}`,
        section('Direct relative imports', imports),
        section('Direct importers', importers),
        section('Same-basename tests', siblingTests(file))
      ].join('\n\n'))
    }
  }
}

function testsAction(root: string): ToolAction {
  return {
    action: 'tests',
    description:
      'Find same-basename tests and test files that directly import one source file. ' +
      'These are test candidates, not evidence of execution or coverage.',
    inputSchema: inputSchema({ path: pathField }, ['path']),
    async run(input) {
      const file = cleanPath(stringArg(input, 'path') ?? '')
      if (!fileSet.has(file)) throw new Error(`${JSON.stringify(file)} is not an indexed file`)
      if (testPattern.test(file)) throw new Error('`path` must name a non-test source file')
      const siblings = siblingTests(file)
      const importers = await importersOf(root, file, true)
      const candidates = [...new Set([...siblings, ...importers])].sort()
      return textResult([
        `Candidate tests for ${file}`,
        candidates.length ? candidates.map((candidate) => `  ${candidate}`).join('\n') : '  (none found)',
        '',
        'Relationship evidence only; this does not measure test execution or coverage.'
      ].join('\n'))
    }
  }
}

function ipcFlowAction(): ToolAction {
  return {
    action: 'ipc_flow',
    description:
      'Show generated preload IPC namespace-to-main owner mappings. Omit namespace to list every mapping.',
    inputSchema: inputSchema({
      namespace: { type: 'string', minLength: 1, description: 'IPC namespace, such as chat or browserDownloads.' }
    }),
    async run(input) {
      const requested = stringArg(input, 'namespace')?.replace(/:\*$/, '')
      const rows = Object.entries(ipcFlows)
        .filter(([namespace]) => !requested || namespace === requested)
        .map(([namespace, owners]) => `${namespace}:* -> ${owners.join(', ')}`)
      if (rows.length === 0) throw new Error(`no indexed IPC namespace matches ${JSON.stringify(requested)}`)
      return textResult(`Preload IPC ownership\n\n${rows.join('\n')}`)
    }
  }
}

export function workspaceActions(root: string): ToolAction[] {
  return [mapAction(), relatedAction(root), testsAction(root), ipcFlowAction()]
}
