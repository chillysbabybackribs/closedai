import { UNIVERSAL_ARTICULATION_INSTRUCTIONS } from '../chat-context/articulation-instructions.js'
import { APPLICATION_INSTRUCTIONS } from '../chat-context/application-instructions.js'
import { engineeringInstructions } from '../chat-context/engineering-instructions.js'
import {
  CLOSEDAI_CONTEXT_TRUST_XML_INSTRUCTION,
  DIRECT_CALL_TOOL_BATCHING_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  TOOL_APPROVAL_DISABLED_INSTRUCTION
} from '../chat-context/product-instructions.js'
import { workspaceNavigationSection } from '../chat-context/workspace-navigation.js'
import { workspaceRulesSection } from '../chat-context/workspace-rules.js'

// The custom agent's system prompt. Antigravity's own default agent assumes its invisible
// browser and an interactive user; this one describes ClosedAI instead and mirrors the Claude
// lane's product guidance. The tool grant that goes with it lives in antigravity-profile.ts.

const INSTRUCTIONS = [
  UNIVERSAL_ARTICULATION_INSTRUCTIONS,
  'You are Antigravity inside ClosedAI. Complete authorized work with your tools and verify it. Ask a plain-text question only when missing information blocks progress; there is no question tool.',
  TOOL_APPROVAL_DISABLED_INSTRUCTION,
  'Use ClosedAI mcp_ tools for the visible signed-in browser. Native browser, search, and image tools are blocked; use the provided ClosedAI tools.',
  CLOSEDAI_CONTEXT_TRUST_XML_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  DIRECT_CALL_TOOL_BATCHING_INSTRUCTION,
  APPLICATION_INSTRUCTIONS,
  engineeringInstructions('antigravity')
].join('\n\n')

// agy's built-in Communication section says every file and symbol MUST be a clickable
// `file://` link, with `#L10-L20` anchors in its example. Measured 2026-09-03: gemini-3.8-flash
// obeys that by opening files it already knows the path of, just to mint a line number, and
// ends up re-verifying the repository map (5 to 13 calls where the other models made 0). The
// link demand is satisfied here from what the model already has, and the map is declared
// settled so there is nothing left to audit.
function fileLinkInstructions(cwd: string): string {
  return (
    'Antigravity\'s own communication rules ask for clickable file:// links on every file and symbol. ' +
    `Satisfy them from what you already know: link a path as file://${cwd}/<relative path> without a ` +
    'line anchor whenever the repository map, the user, or a tool result already establishes it. ' +
    'Add a #L anchor only for a line you read this turn. Never open a file, search, or list a ' +
    'directory solely to produce a line number or to confirm a path you already have.'
  )
}

const MAP_TRUST_INSTRUCTIONS =
  'The repository map above was read from the checkout when this process started and is the settled ' +
  'answer for where files live. Where it says a listing is exhaustive, answer from it and link the ' +
  'paths; do not re-verify it with grep_search, find_by_name, list_dir, view_file, or repository ' +
  'scripts, and do not audit the generator. Search only for what the map does not state.'

/** Stable product guidance for every Antigravity session, plus orientation when the workspace is this checkout. */
export function antigravityAgentInstructions(cwd: string): string {
  const navigation = workspaceNavigationSection(cwd)
  const rules = workspaceRulesSection(cwd)
  return [
    INSTRUCTIONS,
    fileLinkInstructions(cwd),
    navigation && `${navigation}\n\n${MAP_TRUST_INSTRUCTIONS}`,
    rules
  ].filter(Boolean).join('\n\n')
}
