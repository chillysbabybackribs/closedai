import { defineActionTool } from '../action-tool.js'
import type { ToolNamespace } from '../tool.js'
import { uiControlFamilies } from '../../../shared/ui-controls.js'
import type { BrowserHostProvider } from '../browser/host.js'
import { appAgentActions } from './agent.js'
import { appCommandActions } from './command.js'
import { appMenuTool } from './menu.js'
import type { AppCommandHost, AppUiHost } from './host.js'
import { appStateTool } from './state.js'
import { appUiActions } from './ui.js'

/**
 * closedai_app: the app's own state and commands, deterministic and DOM-free, plus a ui tool that
 * drives real controls by their manifest id for when the interaction itself is under test.
 */
export function appTools(
  app: () => AppCommandHost | null,
  ui: () => AppUiHost | null,
  page: BrowserHostProvider = () => null
): ToolNamespace {
  return {
    name: 'closedai_app',
    description: 'State, commands, and control-level interaction for the ClosedAI desktop app.',
    tools: [
      appStateTool(app, ui),
      defineActionTool({
        name: 'command',
        deferLoading: true,
        description:
          'Deterministic app commands via main-process services — no DOM inspection. Operate panes, models, and ' +
          'browser tabs; use closedai_app.state for facts and closedai_app.menu for any application menu row. Use ' +
          'closedai_app.ui only when a real control must be exercised as a batched fallback.',
        actions: appCommandActions(app, ui, page)
      }),
      appMenuTool(ui),
      defineActionTool({
        name: 'agent',
        deferLoading: true,
        description:
          'Drive the agent run of another pane: start attaches the main-process cycle loop with standing instructions; ' +
          'pause, resume, and stop act on an existing run; finish lets a run end itself when its work is complete. ' +
          'state.chat.agentRun reports status, cycle, and pause reason.',
        actions: appAgentActions(app)
      }),
      defineActionTool({
        name: 'ui',
        deferLoading: true,
        description:
          'Drive the real ClosedAI renderer by stable control id. Start with controls (scoped by surface or ' +
          `query) to see ids, items, and state; families: ${uiControlFamilies().join(', ')}. Rows, tabs, and ` +
          'menu items repeat, so pass item or match with their control. Prefer state and command; real click/type/key ' +
          'actions require fallback_reason and belong in one batch with inspection and verification. Application menu ' +
          'rows run directly through closedai_app.menu; other menus and dialogs must be opened first; never read renderer ' +
          'source to find a control.',
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
