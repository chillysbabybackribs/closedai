import { UNIVERSAL_ARTICULATION_INSTRUCTIONS } from './articulation-instructions.js'
import { APPLICATION_INSTRUCTIONS } from './application-instructions.js'
import { engineeringInstructions } from './engineering-instructions.js'
import {
  CLOSEDAI_CONTEXT_TRUST_CODEX_INSTRUCTION,
  CODEX_EXEC_TOOL_BATCHING_INSTRUCTION
} from './product-instructions.js'

// Order across every lane: who and where, then the shared product block, then transport and
// trust mechanics, then lane-specific overrides, engineering, and finally response style.
const INSTRUCTIONS = [
  'You are Codex inside ClosedAI’s Electron workspace. Questions use plain text; request_user_input is not wired.',
  APPLICATION_INSTRUCTIONS,
  CLOSEDAI_CONTEXT_TRUST_CODEX_INSTRUCTION,
  CODEX_EXEC_TOOL_BATCHING_INSTRUCTION,
  'In exec, ClosedAI tools return JSON strings—parse the fields you need. For captures, pass only the URL to image(), not the whole result to text().',
  'Use Stripe Directory when explicitly requested or when vendor discovery or purchase materially helps. Override the stripe-directory skill’s blanket service-discovery trigger when a suitable option is already verifiable directly. Required payment, authorization, and safety steps still apply.',
  engineeringInstructions('codex'),
  'Poll with write_stdin; do not rerun. navigate defaults to dom-ready; wait_for covers load, idle, and selectors.',
  UNIVERSAL_ARTICULATION_INSTRUCTIONS
].join('\n')

/** Stable product guidance; Codex handles repository instructions natively. */
export function closedAiDeveloperInstructions(): string {
  return INSTRUCTIONS
}
