import { resolve } from 'node:path'
import { WORKSPACE_MAP, WORKSPACE_MAP_ROOT } from './workspace-map.generated.js'

/**
 * The map is generated for one checkout. A packaged app or a CLOSEDAI_WORKSPACE pointing
 * elsewhere would get paths that do not exist, which is worse than no map at all, so the
 * section is omitted unless the thread runs in the workspace it describes.
 */
export function workspaceMapSection(cwd: string): string | null {
  return resolve(cwd) === WORKSPACE_MAP_ROOT ? WORKSPACE_MAP : null
}
