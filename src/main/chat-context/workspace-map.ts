import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  WORKSPACE_AREAS,
  WORKSPACE_CONTROL_FAMILIES,
  WORKSPACE_FILES,
  WORKSPACE_INDEX_ROOT,
  WORKSPACE_IPC_FLOWS
} from '../tools/workspace/workspace-index.generated.js'

// Orientation, not search. A model that knows where things are does not spend a turn asking,
// and unlike a tool this cannot be declined: it is already in the prompt. Every line here is
// derived by scripts/repo-tree.mjs and held current by `npm run map:check` in the gate, so it
// carries no hand-written claim that could quietly go stale.

type Area = {
  directory: string
  files: number
  prefixes: readonly (readonly [string, number])[]
  listed: readonly string[]
}

type WorkspaceIndex = {
  /** Where these facts came from: the checkout on disk, or the copy compiled into this build. */
  source: 'checkout' | 'build'
  files: readonly string[]
  areas: readonly Area[]
  families: Readonly<Record<string, readonly string[]>>
  flows: Readonly<Record<string, readonly string[]>>
}

/** What this build was compiled against: the floor when the checkout cannot be read. */
const BUILT_IN: WorkspaceIndex = {
  source: 'build',
  files: WORKSPACE_FILES,
  areas: WORKSPACE_AREAS,
  families: WORKSPACE_CONTROL_FAMILIES,
  flows: WORKSPACE_IPC_FLOWS
}

const GENERATED_MODULE = join(WORKSPACE_INDEX_ROOT, 'src/main/tools/workspace/workspace-index.generated.ts')

let cached: { mtimeMs: number; index: WorkspaceIndex } | null = null

/** One `export const NAME = <json>` line of the generated module; null when it does not parse. */
function exported(source: string, name: string): unknown {
  const match = new RegExp(`^export const ${name} = (.+?)(?: as const)?$`, 'm').exec(source)
  if (!match) return null
  try {
    return JSON.parse(match[1]!)
  } catch {
    return null
  }
}

function isOwnerMap(value: unknown): value is Record<string, readonly string[]> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The bundled constants are as old as the build, and an app outlives edits to the checkout it
 * describes — including edits made by another pane in the same session. Since this map asks to
 * be trusted instead of re-derived, read the generated module back whenever it changes on disk;
 * the compiled-in copy is only the fallback for a checkout that cannot be read.
 */
export function currentWorkspaceIndex(): WorkspaceIndex {
  try {
    const mtimeMs = statSync(GENERATED_MODULE).mtimeMs
    if (cached?.mtimeMs === mtimeMs) return cached.index
    const source = readFileSync(GENERATED_MODULE, 'utf8')
    const files = exported(source, 'WORKSPACE_FILES')
    const areas = exported(source, 'WORKSPACE_AREAS')
    const families = exported(source, 'WORKSPACE_CONTROL_FAMILIES')
    const flows = exported(source, 'WORKSPACE_IPC_FLOWS')
    // A half-written or reshaped module is worse than an old one: take all four or none.
    if (!Array.isArray(files) || !Array.isArray(areas) || !isOwnerMap(families) || !isOwnerMap(flows)) return BUILT_IN
    const index = { source: 'checkout', files, areas, families, flows } as WorkspaceIndex
    cached = { mtimeMs, index }
    return index
  } catch {
    return BUILT_IN
  }
}

function areaLine(area: Area): string {
  const directory = area.directory === '.' ? '(root)' : area.directory
  const prefixes = area.prefixes.map(([prefix, count]) => `${prefix} ${count}`).join(', ')
  // Small directories are named outright; large ones are described by their prefix rule.
  const detail = area.listed.length ? `: ${area.listed.join(', ')}` : prefixes ? `; ${prefixes}` : ''
  return `  ${directory} (${area.files}${detail})`
}

/** The generated half of the orientation capsule: where things are, as facts. */
export function workspaceMapSection(): string {
  const index = currentWorkspaceIndex()
  const areas = index.areas.map(areaLine).join('\n')
  const families = Object.entries(index.families)
    .map(([family, owners]) => `  ${family}.* -> ${owners.join(', ')}`)
    .join('\n')
  const flows = Object.entries(index.flows)
    .map(([namespace, owners]) => `${namespace} -> ${owners.join(', ')}`)
    .join('; ')

  return [
    `Repository map (generated from this checkout, ${index.files.length} files). Derive the path from these rules before searching for it.`,
    'Control families and IPC owners below are exhaustive for non-test source: treat them as already verified rather than re-deriving them with a search. Area prefixes are the dominant naming rules, not complete listings; a directory shown with its files listed is complete.',
    'Entry points: src/main/index.ts, src/preload/index.ts, src/renderer/App.tsx. A test sits beside its module as <name>.test.ts. A feature stylesheet is src/renderer/styles/<feature>/<concern>.css.',
    `Areas (file count; dominant name prefixes — a prefix is the rule, so the Claude stream parser is src/main/claude/claude-stream.ts):\n${areas}`,
    `Control ids: a data-ui id's family names the file that renders it, and every id is declared in src/shared/ui-controls.ts.\n${families}`,
    `Preload IPC namespace -> main owner: ${flows}.`
  ].join('\n\n')
}
