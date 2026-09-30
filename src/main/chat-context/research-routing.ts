import { needsResearchToolSlice } from '../tools/tool-slice-select.js'
import type { AdditionalContext } from './turn-context.js'

export const RESEARCH_ROUTING_CONTEXT = 'closedai.research.routing'

const ROUTING_TEXT =
  'Official web / pricing / doc tasks (vendor compare, linked docs, SPA JSON). One headless call when URLs are known: embedded_browser.session fetch_many for 2+ pages, or session fetch + text_contains for one. SPA search JSON (HN Algolia, etc.): browser_cdp.capture_spa only—do not chain page.navigate + network.requests + script.query, and do not substitute the public REST search API when the prompt asks for the live client XHR. Unfamiliar origins: site.discover bootstrap then expand. Visible tab only when the user should see the page or live DOM is required—not for plain doc/pricing text. Do not read this repository or on-disk MCP JSON schemas to learn tools; use attached ClosedAI MCP tools and their descriptions. Skip provider web search when session.fetch can GET the URL directly. search.run/search.query for discovery when the URL is unknown; not snippet-only compare tables. Task tool slices are on by default so session, fetch_many, tool_batch, and capture_spa are eager on this turn class.'

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
