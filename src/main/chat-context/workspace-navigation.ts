import { resolve } from 'node:path'
import { WORKSPACE_INDEX_ROOT } from '../tools/workspace/workspace-index.generated.js'
import { workspaceMapSection } from './workspace-map.js'

const NAVIGATION_PROSE = [
  'Current guides: docs/application.md, docs/model-context.md, docs/tools.md. Dated research is historical.',
  'Use the generated map for paths; closedai_workspace.inspect find for unknown locations, read for a known symbol/range. Supply known_hash only for source still in context.'
].join('\n')

/** Only inject app-authored orientation when the thread runs in the checkout it describes. */
export function workspaceNavigationSection(cwd: string): string | null {
  return resolve(cwd) === WORKSPACE_INDEX_ROOT ? `${NAVIGATION_PROSE}\n\n${workspaceMapSection()}` : null
}
