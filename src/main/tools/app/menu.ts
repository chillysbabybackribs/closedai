import { setTimeout as delay } from 'node:timers/promises'
import { jsonResult, objectSchema } from '../json-result.js'
import { defineTool, stringArg, type ToolDefinition } from '../tool.js'
import { MODEL_MENU_KEYS } from '../../../shared/app-menu-run.js'
import { requireHost, type AppUiHost, type AppUiState } from './host.js'

/** A row that opens a lazily loaded dialog shows it a few hundred ms after it ran. */
const SETTLE_MS = 1_000
const SETTLE_POLL_MS = 75

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
      'refused while that is the calling chat. A row that ran returns the ui state once it changes (views in front ' +
      'under ui.layout.views, open dialogs), waiting up to a second; uiChanged false means the effect is not part of ' +
      'ui state (zoom, full screen, search focus).',
    inputSchema: objectSchema({
      key: { type: 'string', enum: [...MODEL_MENU_KEYS], description: 'Stable menu row key.' }
    }, ['key']),
    run: async (input, context) => {
      const host = requireHost(ui, 'app ui')
      const before = surfaceOf(await host.uiState())
      const result = await host.runMenu(stringArg(input, 'key')!, context.paneId ?? null)
      if (!result.ran) return jsonResult(result)
      const started = Date.now()
      let after = await host.uiState()
      while (surfaceOf(after) === before && Date.now() - started < SETTLE_MS && !context.signal.aborted) {
        await delay(SETTLE_POLL_MS)
        after = await host.uiState()
      }
      return jsonResult({ ...result, uiChanged: surfaceOf(after) !== before, ui: after })
    }
  })
}

/** What a menu row can change; focus and viewport move for unrelated reasons. */
function surfaceOf(state: AppUiState): string {
  const { layout, dialogs, menus, chatSearchOpen, historyOpen, downloadsOpen } = state
  return JSON.stringify({ layout, dialogs, menus, chatSearchOpen, historyOpen, downloadsOpen })
}
