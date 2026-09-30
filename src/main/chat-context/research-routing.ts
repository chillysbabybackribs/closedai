import { needsResearchToolSlice } from '../tools/tool-slice-select.js'
import type { AdditionalContext } from './turn-context.js'

export const RESEARCH_ROUTING_CONTEXT = 'closedai.research.routing'

const ROUTING_TEXT =
  'Multi-source official web research (vendor compare, linked docs, checklists). Ground claims on each vendor site: embedded_browser.session fetch and/or site.discover bootstrap then expand per origin; search.run for parallel official URLs. search.query and native web search stay valid for quick facts and finding URLs—not as the only evidence for comparison tables. Session fetch uses the app browser partition; a visible tab is optional.'

/** Per-turn routing hint when the prompt matches the research task-slice heuristic (all providers). */
export function buildResearchRoutingAdditionalContext(prompt: string): AdditionalContext | undefined {
  if (!needsResearchToolSlice({ prompt, surface: null })) return undefined
  return {
    [RESEARCH_ROUTING_CONTEXT]: {
      kind: 'application',
      value: ROUTING_TEXT
    }
  }
}
