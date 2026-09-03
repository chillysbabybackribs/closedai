import { jsonResult, objectSchema } from '../json-result.js'
import { defineTool, stringArg, type ToolDefinition } from '../tool.js'
import { APP_STATE_SECTIONS, requireHost, type AppCommandHost, type AppStateSection, type AppUiHost } from './host.js'

const SECTIONS = [...APP_STATE_SECTIONS, 'ui'] as const
type Section = (typeof SECTIONS)[number]

/** Compact app facts from the main process plus renderer-only overlay/composer state. */
export function appStateTool(app: () => AppCommandHost | null, ui: () => AppUiHost | null): ToolDefinition {
  return defineTool({
    name: 'state',
    description:
      'Read compact ClosedAI app state without touching the DOM: workspace panes (ids, titles, running), the ' +
      'selected or given chat pane (connection, model, thread, running, context usage, last user/assistant text), ' +
      'browser tabs, downloads, window, and ui (open dialogs and menus, drawer, history panel, composer enabled/' +
      'running/canSend, focused control). Use it for facts and assertions before and after commands; pass include ' +
      'to return only the sections you need.',
    inputSchema: objectSchema({
      include: {
        type: 'array', minItems: 1, uniqueItems: true,
        items: { type: 'string', enum: [...SECTIONS] },
        description: 'Sections to return; defaults to all of them.'
      },
      pane_id: { type: 'string', minLength: 1, description: 'Chat pane for the chat section; defaults to the selected pane.' }
    }),
    run: async (input, context) => {
      const include = sectionsFrom(input.include)
      const host = requireHost(app, 'app state')
      const mainSections = include.filter((section): section is AppStateSection => section !== 'ui')
      const result = host.state(mainSections, stringArg(input, 'pane_id'), context.paneId ?? null)
      if (include.includes('ui')) result.ui = await requireHost(ui, 'app automation').uiState()
      return jsonResult(result)
    }
  })
}

function sectionsFrom(value: unknown): Section[] {
  if (!Array.isArray(value) || value.length === 0) return [...SECTIONS]
  return value.filter((entry): entry is Section => (SECTIONS as readonly string[]).includes(String(entry)))
}
