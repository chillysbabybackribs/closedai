import { defineActionTool } from '../action-tool.js'
import type { ToolNamespace } from '../tool.js'
import { uiControlFamilies } from '../../../shared/ui-controls.js'
import { appCommandActions } from './command.js'
import type { AppCommandHost, AppUiHost } from './host.js'
import { appStateTool } from './state.js'
import { appUiActions } from './ui.js'

/**
 * closedai_app: the app's own state and commands, deterministic and DOM-free, plus a ui tool that
 * drives real controls by their manifest id for when the interaction itself is under test.
 */
export function appTools(app: () => AppCommandHost | null, ui: () => AppUiHost | null): ToolNamespace {
  return {
    name: 'closedai_app',
    description: 'State, commands, and control-level interaction for the ClosedAI desktop app.',
    tools: [
      appStateTool(app, ui),
      defineActionTool({
        name: 'command',
        description:
          'Deterministic ClosedAI app commands: they call the same main-process services the UI does, so they ' +
          'need no inspection, refs, or waits. Use these to operate the app (open or send to another pane, stop ' +
          'it, switch model, manage browser tabs) and closedai_app.state to check results. Use closedai_app.ui ' +
          'only when the real control must be exercised as a recorded, batched fallback.',
        actions: appCommandActions(app)
      }),
      defineActionTool({
        name: 'ui',
        description:
          'Drive the real ClosedAI renderer by stable control id. Start with controls (scoped by surface or ' +
          `query) to see ids, items, and state; families: ${uiControlFamilies().join(', ')}. Rows, tabs, and ` +
          'menu items repeat, so pass item or match with their control. Prefer state and command; real click/type/key ' +
          'actions require fallback_reason and belong in one batch with inspection and verification. Menus and dialogs ' +
          'must be opened first; never read renderer source to find a control.',
        actions: appUiActions(ui)
      })
    ]
  }
}

export type {
  AppClickTarget,
  AppCommandHost,
  AppControl,
  AppControlsResult,
  AppScrollTarget,
  AppTypeTarget,
  AppUiHost,
  AppUiState,
  AppWaitOptions,
  AppWaitResult
} from './host.js'
