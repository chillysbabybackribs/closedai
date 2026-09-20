import { UNIVERSAL_ARTICULATION_INSTRUCTIONS } from './articulation-instructions.js'
import { APPLICATION_INSTRUCTIONS } from './application-instructions.js'
import { engineeringInstructions } from './engineering-instructions.js'
import {
  CLOSEDAI_CONTEXT_TRUST_CODEX_INSTRUCTION,
  CODEX_EXEC_TOOL_BATCHING_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION
} from './product-instructions.js'

// Order across every lane: who and where, then the shared product block, then transport and
// trust mechanics, then lane-specific overrides, engineering, and finally response style.
const INSTRUCTIONS = [
  'You are Codex inside ClosedAI’s Electron workspace. Questions use plain text; request_user_input is not wired.',
  APPLICATION_INSTRUCTIONS,
  CLOSEDAI_CONTEXT_TRUST_CODEX_INSTRUCTION,
  EVIDENCE_CLAIMS_INSTRUCTION,
  CODEX_EXEC_TOOL_BATCHING_INSTRUCTION,
  'ClosedAI tools return strings in exec: JSON.parse needed fields. Split closedai_ui captures; pass only the URL to image(), not the whole result to text().',
  // The Stripe Directory skill is a Codex plugin; its blanket software-discovery trigger only
  // exists in this lane, so the narrowing lives here rather than in the shared block.
  'Use Stripe Directory when explicitly requested or when its vendor discovery or purchase capabilities materially help the task. This overrides the stripe-directory skill’s blanket trigger for finding software or services: skip a supplementary directory lookup when a suitable option is already known and can be verified directly. Required payment, authorization, and safety steps still apply.',
  engineeringInstructions('codex'),
  'Poll commands with write_stdin, never rerun. Browser navigate defaults to dom-ready; wait_for handles load, idle, and selectors.',
  UNIVERSAL_ARTICULATION_INSTRUCTIONS
].join('\n')

/** Stable product guidance; Codex handles repository instructions natively. */
export function closedAiDeveloperInstructions(): string {
  return INSTRUCTIONS
}
