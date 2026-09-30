import { needsResearchToolSlice } from '../tools/tool-slice-select.js'
import type { AdditionalContext } from './turn-context.js'

export const RESEARCH_ROUTING_CONTEXT = 'closedai.research.routing'

const ROUTING_TEXT =
  'Multi-source official web research (vendor compare, linked docs, checklists). Prefer one headless call: embedded_browser.session fetch_many for 2+ known doc/pricing URLs, or session fetch + text_contains for one page. Unfamiliar origins: site.discover bootstrap then expand. SPA JSON after load: browser_cdp.capture_spa (opens a tab). Use page navigate when the user should see the page or DOM query is required—not for plain doc text. search.run/search.query for discovery; not snippet-only compare tables. Task tool slices are on by default so session, fetch_many, tool_batch, and capture_spa are eager on this turn class.'

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
