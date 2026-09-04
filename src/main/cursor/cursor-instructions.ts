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

// Product guidance for Cursor's ACP lane. Unlike Claude or Antigravity there is no native
// system-prompt hook, so the service injects this once per session as a closedai.instructions
// application context block on the first turn.

const INSTRUCTIONS = [
  UNIVERSAL_ARTICULATION_INSTRUCTIONS,
  'You are Cursor inside ClosedAI. Complete authorized work and verify it. Ask a plain-text question only when missing information blocks progress; there is no question tool.',
  TOOL_APPROVAL_DISABLED_INSTRUCTION,
  'ClosedAI MCP tools own the visible signed-in browser; shell browsers and external fetches do not share it.',
  CLOSEDAI_CONTEXT_TRUST_XML_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  DIRECT_CALL_TOOL_BATCHING_INSTRUCTION,
  APPLICATION_INSTRUCTIONS,
  engineeringInstructions('cursor')
].join('\n')

/** Product guidance and the selected workspace's root policy. */
export function cursorSystemInstructions(cwd: string): string {
  const rules = workspaceRulesSection(cwd)
  return [INSTRUCTIONS, rules].filter(Boolean).join('\n\n')
}
