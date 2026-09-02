import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  WORKSPACE_FILES,
  WORKSPACE_IPC_FLOWS
} from './workspace-index.generated.js'

export const indexedFiles: readonly string[] = WORKSPACE_FILES
export const fileSet = new Set<string>(indexedFiles)
export const ipcFlows: Readonly<Record<string, readonly string[]>> = WORKSPACE_IPC_FLOWS
export const testPattern = /\.test\.tsx?$/
const codePattern = /\.(?:js|mjs|ts|tsx)$/
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

export const pathField = {
  type: 'string',
  minLength: 1,
  description: 'Repository-relative file or directory path.'
}

export function inputSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function cleanPath(raw: string): string {
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

export function siblingTests(source: string): string[] {
  return indexedFiles.filter((candidate) => isSiblingTest(source, candidate))
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

export async function importsOf(root: string, file: string): Promise<string[]> {
  if (!codePattern.test(file)) return []
  const source = await readFile(path.join(root, file), 'utf8')
  return [...new Set([...source.matchAll(importPattern)].flatMap((match) => {
    const resolved = resolveImport(file, match[1] ?? match[2])
    return resolved ? [resolved] : []
  }))].sort()
}

export async function importersOf(root: string, target: string, testsOnly = false): Promise<string[]> {
  const candidates = indexedFiles.filter((file) => codePattern.test(file) && (!testsOnly || testPattern.test(file)))
  const imports = await Promise.all(candidates.map(async (file) => [file, await importsOf(root, file)] as const))
  return imports.filter(([, dependencies]) => dependencies.includes(target)).map(([file]) => file).sort()
}

export function section(title: string, files: readonly string[]): string {
  return `${title}:\n${files.length ? files.slice(0, 40).map((file) => `  ${file}`).join('\n') : '  (none)'}`
}
