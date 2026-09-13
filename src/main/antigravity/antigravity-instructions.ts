import { UNIVERSAL_ARTICULATION_INSTRUCTIONS } from '../chat-context/articulation-instructions.js'
import { APPLICATION_INSTRUCTIONS } from '../chat-context/application-instructions.js'
import { engineeringInstructions } from '../chat-context/engineering-instructions.js'
import {
  CLOSEDAI_CONTEXT_TRUST_XML_INSTRUCTION,
  DIRECT_CALL_TOOL_BATCHING_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  TOOL_APPROVAL_DISABLED_INSTRUCTION
} from '../chat-context/product-instructions.js'
import { workspaceRulesSection } from '../chat-context/workspace-rules.js'

// The custom agent's system prompt. Antigravity's own default agent assumes its invisible
// browser and an interactive user; this one describes ClosedAI instead and mirrors the Claude
// lane's product guidance. The tool grant that goes with it lives in antigravity-profile.ts.

const INSTRUCTIONS = [
  UNIVERSAL_ARTICULATION_INSTRUCTIONS,
  'You are Antigravity inside ClosedAI. Questions use plain text; there is no question tool.',
  TOOL_APPROVAL_DISABLED_INSTRUCTION,
  'ClosedAI mcp_ tools operate the visible signed-in browser. Native browser tools use a separate browser; native file search and editing tools are available.',
  CLOSEDAI_CONTEXT_TRUST_XML_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  DIRECT_CALL_TOOL_BATCHING_INSTRUCTION,
  APPLICATION_INSTRUCTIONS,
  engineeringInstructions('antigravity')
].join('\n\n')

// agy's built-in Communication section says every file and symbol MUST be a clickable
// `file://` link, with `#L10-L20` anchors in its example. Measured 2026-09-03: gemini-3.8-flash
// can open files just to mint a line number. Known paths need no invented line anchors.
function fileLinkInstructions(cwd: string): string {
  return (
    'Antigravity\'s own communication rules ask for clickable file:// links on every file and symbol. ' +
    `Satisfy them from what you already know: link a path as file://${cwd}/<relative path> without a ` +
    'line anchor whenever the user or a tool result already establishes it. ' +
    'Add a #L anchor only for a line you read this turn. Never open a file, search, or list a ' +
    'directory solely to produce a line number or to confirm a path you already have.'
  )
}

/** Product guidance and the selected workspace's root policy. */
export function antigravityAgentInstructions(cwd: string): string {
  const rules = workspaceRulesSection(cwd)
  return [
    INSTRUCTIONS,
    fileLinkInstructions(cwd),
    rules
  ].filter(Boolean).join('\n\n')
}
