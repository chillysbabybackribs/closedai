import { resolve } from 'node:path'
import { WORKSPACE_INDEX_ROOT } from '../tools/workspace/workspace-index.generated.js'
import { workspaceMapSection } from './workspace-map.js'

const NAVIGATION_PROSE = [
  'ClosedAI workspace: Electron main process, narrow preload bridge, React renderer, and reusable UI components.',
  'Dependencies: renderer/components -> shared <- preload <- main. Shared contracts live in src/shared/api.ts.',
  'Current behavior and ownership: docs/application.md. Prompt assembly and trust: docs/model-context.md. Tool contracts: docs/tools.md. Dated research records are historical evidence.',
  'The map below is generated and current: read a path off it rather than searching for one. Use closedai_workspace.inspect find for unknown locations; exact symbols include hashed source, local types, tests and styles. For a known path use read with a symbol or range to include the same related excerpts; outline is shape only. Reuse supplied source, read missing ranges, and pass known_hash only for source still in context; stale hashes return fresh content in that call.'
].join('\n')

/** Only inject app-authored orientation when the thread runs in the checkout it describes. */
export function workspaceNavigationSection(cwd: string): string | null {
  return resolve(cwd) === WORKSPACE_INDEX_ROOT ? `${NAVIGATION_PROSE}\n\n${workspaceMapSection()}` : null
}
