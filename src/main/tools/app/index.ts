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
          'Deterministic app commands via main-process services — no DOM inspection. Operate panes, models, and ' +
          'browser tabs; use closedai_app.state for facts. Use closedai_app.ui only when a real control must be exercised as a batched fallback.',
        actions: appCommandActions(app)
      }),
      defineActionTool({
        name: 'ui',
        deferLoading: true,
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
