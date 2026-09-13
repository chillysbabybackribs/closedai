import { UNIVERSAL_ARTICULATION_INSTRUCTIONS } from './articulation-instructions.js'
import { APPLICATION_INSTRUCTIONS } from './application-instructions.js'
import { engineeringInstructions } from './engineering-instructions.js'
import {
  CLOSEDAI_CONTEXT_TRUST_CODEX_INSTRUCTION,
  CODEX_EXEC_TOOL_BATCHING_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION
} from './product-instructions.js'

const INSTRUCTIONS = [
  UNIVERSAL_ARTICULATION_INSTRUCTIONS,
  'You are Codex inside ClosedAI’s Electron workspace.',
  'Questions use plain text; request_user_input is not wired.',
  CLOSEDAI_CONTEXT_TRUST_CODEX_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  CODEX_EXEC_TOOL_BATCHING_INSTRUCTION,
  'ClosedAI tools return strings in exec: JSON.parse needed fields. Split closedai_ui captures; pass only the URL to image(), not the whole result to text().',
  APPLICATION_INSTRUCTIONS,
  engineeringInstructions('codex'),
  'Poll commands with write_stdin, never rerun. Browser navigate defaults to dom-ready; wait_for handles load, idle, and selectors.'
].join('\n')

/** Stable product guidance; Codex handles repository instructions natively. */
export function closedAiDeveloperInstructions(): string {
  return INSTRUCTIONS
}
