import { resolve } from 'node:path'
import { WORKSPACE_INDEX_ROOT } from '../../chat-context/workspace-index.generated.js'
import { defineActionTool } from '../action-tool.js'
import type { ToolNamespace } from '../tool.js'
import { ipcFlowAction } from './ipc-flow.js'
import { mapAction } from './map.js'
import { relatedAction } from './related.js'
import { testsAction } from './tests.js'

/** The generated index describes only this checkout, so do not advertise it elsewhere. */
export function workspaceTools(cwd: string): ToolNamespace | null {
  if (resolve(cwd) !== WORKSPACE_INDEX_ROOT) return null
  return {
    name: 'closedai_workspace',
    description: 'Bounded, read-only navigation over the indexed ClosedAI repository.',
    tools: [
      defineActionTool({
        name: 'inspect',
        description:
          'Query repository structure only when it helps navigate implementation work. Results are ' +
          'scoped so persistent tool history stays small; use ordinary symbol search for exact text.',
        actions: [
          mapAction,
          relatedAction(WORKSPACE_INDEX_ROOT),
          testsAction(WORKSPACE_INDEX_ROOT),
          ipcFlowAction
        ],
        deferLoading: true
      })
    ]
  }
}
