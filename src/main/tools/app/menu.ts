import { jsonResult, objectSchema } from '../json-result.js'
import { defineTool, stringArg, type ToolDefinition } from '../tool.js'
import { MODEL_MENU_KEYS } from '../../../shared/app-menu-run.js'
import { requireHost, type AppUiHost } from './host.js'

/**
 * The application menu by row key: the handler and eligibility a click on the row uses, fired
 * in the renderer without opening the menu. Row keys come from the shared list the renderer's
 * menu model is tested against, so this enum and the real menu cannot drift apart.
 */
export function appMenuTool(ui: () => AppUiHost | null): ToolDefinition {
  return defineTool({
    name: 'menu',
    deferLoading: true,
    description:
      'Plain tool (no action field). Run an application menu row (File, View, Agent, Developer; the dock launcher ' +
      'lists the same rows) by key: the handler a click fires, in one call instead of opening the menu through ' +
      'closedai_app.ui. Opens views (agents, tools, turn-trace, saved-sites, manage-chat-history), dialogs (settings, ' +
      'workspace-layout), and the overview; applies layout presets, zoom, tiling, and browser visibility. A row greyed ' +
      'out right now is not run and returns disabled: true. close-tab and stop-turn act on the selected chat and are ' +
      'refused while that is the calling chat. Returns the row, whether it ran, and the ui state after it.',
    inputSchema: objectSchema({
      key: { type: 'string', enum: [...MODEL_MENU_KEYS], description: 'Stable menu row key.' }
    }, ['key']),
    run: async (input, context) => {
      const host = requireHost(ui, 'app ui')
      const result = await host.runMenu(stringArg(input, 'key')!, context.paneId ?? null)
      return jsonResult(result.ran ? { ...result, ui: await host.uiState() } : result)
    }
  })
}
