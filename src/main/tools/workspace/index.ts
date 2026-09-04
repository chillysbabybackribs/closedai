import { resolve } from 'node:path'
import { WORKSPACE_INDEX_ROOT } from './workspace-index.generated.js'
import { defineActionTool } from '../action-tool.js'
import type { ToolNamespace } from '../tool.js'
import { findAction } from './find.js'
import { ipcFlowAction } from './ipc-flow.js'
import { mapAction } from './map.js'
import { outlineAction } from './outline.js'
import { relatedAction } from './related.js'
import { testsAction } from './tests.js'
import { readAction } from './read.js'

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
          'Navigate this repository: locate code by name, read a file\'s shape, and follow structure. ' +
          'Use `find` for an unknown location: a unique exact symbol includes source, local types, tests and styles. ' +
          'Use `read` for a known path/symbol/range with the same hashed context; `outline` is for shape only. ' +
          'Reuse returned source; read only missing ranges. Results are scoped so persistent ' +
          'tool history stays small. Results are plain text; in exec scripts the return value is that string.',
        actions: [
          findAction(WORKSPACE_INDEX_ROOT),
          outlineAction(WORKSPACE_INDEX_ROOT),
          mapAction,
          relatedAction(WORKSPACE_INDEX_ROOT),
          testsAction(WORKSPACE_INDEX_ROOT),
          ipcFlowAction,
          readAction(WORKSPACE_INDEX_ROOT)
        ]
      })
    ]
  }
}
