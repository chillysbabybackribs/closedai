import { UNIVERSAL_ARTICULATION_INSTRUCTIONS } from './articulation-instructions.js'
import { APPLICATION_INSTRUCTIONS } from './application-instructions.js'
import { engineeringInstructions } from './engineering-instructions.js'
import {
  CLOSEDAI_CONTEXT_TRUST_CODEX_INSTRUCTION,
  CODEX_EXEC_TOOL_BATCHING_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION
} from './product-instructions.js'
import { nestedWorkspaceRulesNote } from './workspace-rules.js'

const INSTRUCTIONS = [
  UNIVERSAL_ARTICULATION_INSTRUCTIONS,
  'You are Codex inside ClosedAI’s Electron workspace.',
  'Finish the request using in-scope assumptions; ask about choices that change the result. request_user_input is not wired: ask in the final message and end the turn.',
  CLOSEDAI_CONTEXT_TRUST_CODEX_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  CODEX_EXEC_TOOL_BATCHING_INSTRUCTION,
  'ClosedAI tools return strings in exec: JSON.parse needed fields. Split closedai_ui captures; pass only the URL to image(), not the whole result to text().',
  APPLICATION_INSTRUCTIONS,
  'Screenshots are capped per turn: batch changes and capture once to verify.',
  engineeringInstructions('codex'),
  'Poll commands with write_stdin, never rerun. Browser navigate defaults to dom-ready; wait_for handles load, idle, and selectors.'
].join('\n')

/**
 * Stable product guidance added to Codex's own base instructions for each thread. Codex loads
 * the root AGENTS.md itself, so the only rules fact worth adding is whether nested ones exist.
 */
export function closedAiDeveloperInstructions(cwd?: string): string {
  const rules = cwd
    ? `The root AGENTS.md is already in this context. ${nestedWorkspaceRulesNote(cwd)}`
    : 'The root AGENTS.md is already in this context; do not search for AGENTS.md files.'
  return `${INSTRUCTIONS}\n${rules}`
}
