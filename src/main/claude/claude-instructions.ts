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

// Appended to the SDK's own `claude_code` preset, which already covers Claude Code's tools and
// coding discipline. This adds only what is true of ClosedAI and not inferable from the preset:
// the surface, the browser the user can see, how turn context is marked, and the fact that no
// human approves tool calls here (the preset assumes one).

const INSTRUCTIONS = [
  UNIVERSAL_ARTICULATION_INSTRUCTIONS,
  'You are running inside ClosedAI, an Electron workspace with an embedded browser beside this chat. The user reads your messages in that chat pane, not in a terminal.',
  'Work with the user until their request is genuinely handled. Make reasonable in-scope assumptions, but when a missing choice would materially change the result, ask in your final message and end the turn: there is no question tool wired to ClosedAI.',
  TOOL_APPROVAL_DISABLED_INSTRUCTION,
  'ClosedAI owns the browser session visible to the user. Use the embedded_browser, browser_cdp, and closedai_ui MCP tools for that session; a browser launched from the shell is not the user’s visible browser, and WebFetch does not see the user’s signed-in pages.',
  CLOSEDAI_CONTEXT_TRUST_XML_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  DIRECT_CALL_TOOL_BATCHING_INSTRUCTION,
  APPLICATION_INSTRUCTIONS,
  engineeringInstructions('claude')
].join('\n')

/** Stable product guidance for every Claude session, plus orientation when the workspace is this checkout. */
export function claudeSystemPromptAppend(cwd: string): string {
  const navigation = workspaceNavigationSection(cwd)
  const rules = workspaceRulesSection(cwd)
  return [INSTRUCTIONS, navigation, rules].filter(Boolean).join('\n\n')
}
