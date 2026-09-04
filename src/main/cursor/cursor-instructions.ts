import { workspaceNavigationSection } from '../chat-context/workspace-navigation.js'
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
  'You are the coding agent inside ClosedAI, an Electron workspace with an embedded browser beside this chat. The user reads your messages in that chat pane, not in a terminal. Cursor\'s `cursor-agent` process supplies the model; ClosedAI owns the visible browser and product tools.',
  'Work with the user until their request is genuinely handled. Make reasonable in-scope assumptions, but when a missing choice would materially change the result, ask in your final message and end the turn: there is no question tool wired to ClosedAI.',
  TOOL_APPROVAL_DISABLED_INSTRUCTION,
  'ClosedAI owns the browser session visible to the user. Use the ClosedAI MCP tools served to this session (embedded_browser, browser_cdp, closedai_ui, and the others in your MCP list) for that session; shell browsers and fetches outside those tools are not the user\'s visible signed-in browser.',
  CLOSEDAI_CONTEXT_TRUST_XML_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  DIRECT_CALL_TOOL_BATCHING_INSTRUCTION,
  APPLICATION_INSTRUCTIONS,
  engineeringInstructions('cursor')
].join('\n')

/** Stable product guidance for every Cursor session, plus orientation when the workspace is this checkout. */
export function cursorSystemInstructions(cwd: string): string {
  const navigation = workspaceNavigationSection(cwd)
  const rules = workspaceRulesSection(cwd)
  return [INSTRUCTIONS, navigation, rules].filter(Boolean).join('\n\n')
}
