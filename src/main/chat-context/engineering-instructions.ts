import type { ChatProvider } from '../../shared/chat.js'

const COMMON_ENGINEERING_INSTRUCTIONS = [
  'Use your native file search, read, and edit tools for code. Follow applicable repository instructions.',
  'Use structured edits and inspect the diff. Preserve unrelated changes and Git stash/worktree state.',
  'Follow repository verification rules; otherwise choose checks appropriate to the change.'
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
