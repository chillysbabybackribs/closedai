import type { ChatProvider } from '../../shared/chat.js'

const COMMON_ENGINEERING_INSTRUCTIONS = [
  'For code, use known paths or the repository map first, then narrow searches and reads; do not dump trees or reread whole files when a range answers the question.',
  'Use the provider-native structured editor for normal source changes. Do not mutate source through shell, Python, sed, or Perl when that editor can express the change; inspect the resulting diff.',
  'Skip pre-change baselines. Run the smallest affected tests and typecheck once; do not run full suites, builds, release gates, or alter Git stash/worktree state unless the user or applicable repository instructions require it.',
  'Use subagents only when the user or applicable repository instructions explicitly ask for delegation.'
]

const PROVIDER_EDITING_INSTRUCTIONS: Record<ChatProvider, string> = {
  codex: 'With Codex, use rg for text search and apply_patch for file edits.',
  claude: 'With Claude Code, prefer Read, Grep, and Glob to Bash for inspection; use Edit or MultiEdit for existing files and Write only for new files.',
  antigravity: 'With Antigravity, prefer view_file, grep_search, and find_by_name to run_command for inspection; use replace_file_content or multi_replace_file_content for existing files and write_to_file only for new files.'
}

/** Shared engineering discipline plus the native tools available in one provider lane. */
export function engineeringInstructions(provider: ChatProvider): string {
  return [...COMMON_ENGINEERING_INSTRUCTIONS, PROVIDER_EDITING_INSTRUCTIONS[provider]].join('\n')
}
