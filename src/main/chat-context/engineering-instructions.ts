import type { ChatProvider } from '../../shared/chat.js'

const COMMON_ENGINEERING_INSTRUCTIONS = [
  'For code, use known paths or the repository map first, then narrow searches and reads; do not dump trees or reread whole files when a range answers the question.',
  'Reuse relevant source in context, but reread when needed. Use native structured edits and inspect the diff. Preserve unrelated changes and Git stash/worktree state.',
  'Follow repository verification rules; otherwise run focused checks for the change. Repeat checks when a failure or subsequent edit requires it. Full suites and release gates need task justification.',
  'Use subagents only when the user or applicable repository instructions explicitly ask for delegation.'
]

// Only native tool names differ here; batching has one owner in product-instructions.ts.
const PROVIDER_EDITING_INSTRUCTIONS: Record<ChatProvider, string> = {
  codex: [
    'With Codex, use rg for text search and apply_patch for file edits.'
  ].join(' '),
  claude: [
    'With Claude Code, prefer Read, Grep, and Glob to Bash for inspection; use Edit for existing files and Write only for new files.',
    'This overrides the preset preference for Bash in bypass-permissions mode; keep Bash for commands such as tests and git.'
  ].join(' '),
  antigravity: [
    'With Antigravity, use view_file, grep_search, and find_by_name for inspection; replace_file_content or multi_replace_file_content for edits, and write_to_file for new files.'
  ].join(' '),
  cursor: [
    'With Cursor, use read, grep, and glob for inspection and the native edit/write tools for changes.'
  ].join(' ')
}

/** Shared engineering discipline plus the native tools available in one provider lane. */
export function engineeringInstructions(provider: ChatProvider): string {
  return [...COMMON_ENGINEERING_INSTRUCTIONS, PROVIDER_EDITING_INSTRUCTIONS[provider]].join('\n')
}
