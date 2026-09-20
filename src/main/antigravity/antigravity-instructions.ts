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

// gemini-3.8-flash follows concrete procedures and skips dispositions. Measured 2026-09-20 with
// the shared objective instruction in place: four search_web calls, every query scoped to the
// named site, no alternatives considered, none reported; Claude and Codex did both on the same
// prompt. The link rule above was the same lesson, so this states the search as steps.
const DISCOVERY_PROCEDURE =
  'When a request names a site, tool, or source for a discovery or research task, the named source is step one, not the whole procedure. ' +
  'Before writing the final answer: run at least one search for alternatives to the named source (for example "<source> alternatives" or "sites like <source>"), ' +
  'open the strongest one or two candidates, and keep any that serve the same objective at the same or higher quality. ' +
  'End the answer with a short "Sources checked" list naming each alternative and whether it was used or set aside and why. ' +
  'Do this even when the named source turns out to be the best; the user is also asking what else exists.'

/** Product guidance and the selected workspace's root policy. */
export function antigravityAgentInstructions(cwd: string): string {
  const rules = workspaceRulesSection(cwd)
  return [
    INSTRUCTIONS,
    fileLinkInstructions(cwd),
    DISCOVERY_PROCEDURE,
    rules
  ].filter(Boolean).join('\n\n')
}
