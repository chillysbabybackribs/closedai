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
      'Compact app state without DOM: workspace (caller, selected pane, active project, latest projectSwitch status), chat (your model, project, thread, usage, last messages), browser, downloads, window, ui. Pass include for subsets only.',
    inputSchema: objectSchema({
      include: {
        type: 'array', minItems: 1, uniqueItems: true,
        items: { type: 'string', enum: [...SECTIONS] },
        description: 'Sections to return; defaults to all of them.'
      },
      pane_id: { type: 'string', minLength: 1, description: 'Chat pane for the chat section; defaults to the calling pane, or selected pane when no caller is present.' }
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
