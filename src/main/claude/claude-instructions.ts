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

// Appended to the SDK's own `claude_code` preset, which already covers Claude Code's tools and
// coding discipline. This adds only what is true of ClosedAI and not inferable from the preset:
// the surface, the browser the user can see, how turn context is marked, and the fact that no
// human approves tool calls here (the preset assumes one).

const INSTRUCTIONS = [
  UNIVERSAL_ARTICULATION_INSTRUCTIONS,
  'You are Claude Code inside ClosedAI. Questions use plain text; there is no question tool.',
  TOOL_APPROVAL_DISABLED_INSTRUCTION,
  'ClosedAI MCP tools own the visible signed-in browser; shell browsers and WebFetch do not share it.',
  CLOSEDAI_CONTEXT_TRUST_XML_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  DIRECT_CALL_TOOL_BATCHING_INSTRUCTION,
  APPLICATION_INSTRUCTIONS,
  engineeringInstructions('claude')
].join('\n')

/** Product guidance and the selected workspace's root policy. */
export function claudeSystemPromptAppend(cwd: string): string {
  const rules = workspaceRulesSection(cwd)
  return [INSTRUCTIONS, rules].filter(Boolean).join('\n\n')
}
