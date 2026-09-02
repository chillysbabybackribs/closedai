import { resolve } from 'node:path'
import { WORKSPACE_INDEX_ROOT } from '../tools/workspace/workspace-index.generated.js'

const NAVIGATION_CAPSULE = [
  'ClosedAI workspace: Electron main process, narrow preload bridge, React renderer, and reusable UI components.',
  'Dependencies: renderer/components -> shared <- preload <- main. Shared contracts live in src/shared/api.ts.',
  'Entry points: src/main/index.ts, src/preload/index.ts, and src/renderer/App.tsx.',
  'Locate symbols with rg -n; use the closedai_workspace.inspect tool for scoped maps, import relationships, candidate tests, or IPC ownership.'
].join('\n')

/** Only inject app-authored orientation when the thread runs in the checkout it describes. */
export function workspaceNavigationSection(cwd: string): string | null {
  return resolve(cwd) === WORKSPACE_INDEX_ROOT ? NAVIGATION_CAPSULE : null
}
