import type { ChatProvider } from '../../shared/chat.js'

const COMMON_ENGINEERING_INSTRUCTIONS = [
  'For code, use known paths or the repository map first, then narrow searches and reads; do not dump trees or reread whole files when a range answers the question.',
  'Reuse source still in context; read missing ranges or refresh after possible changes, including another pane\'s edits. A file hash identifies a snapshot, not coverage of omitted lines or an edit lock.',
  'Cost is counted in model passes, not in calls: every read, search, and check whose target you already know belongs in the same pass, and one more call inside a pass is far cheaper than another pass. The lane note below says how that batch is expressed here.',
  'Use the provider-native structured editor for normal source changes. Do not mutate source through shell, Python, sed, or Perl when that editor can express the change; inspect the resulting diff.',
  'Skip pre-change baselines. Run the smallest affected tests and typecheck once; do not run full suites, builds, release gates, or alter Git stash/worktree state unless the user or applicable repository instructions require it.',
  'Use subagents only when the user or applicable repository instructions explicitly ask for delegation.'
]

// Each lane batches differently, so the same discipline needs different mechanics. Measured
// 2026-09-03 over the providers' own transcripts: Claude app panes put more than one call in
// 23% of tool-bearing responses and spent 692 of 877 calls on Bash, because bypassPermissions
// makes the `claude_code` preset ask for shell over the dedicated tools; Codex batches inside
// one `exec` script (46 of 279 used Promise.all) since code mode emits one call per pass; agy
// streams one tool step per pass and has no parallel form at all.
const PROVIDER_EDITING_INSTRUCTIONS: Record<ChatProvider, string> = {
  codex: [
    'With Codex, use rg for text search and apply_patch for file edits.',
    'One exec script is one model pass, so put every independent read, search, and check for that pass in the same script: await them together (Promise.all) or chain the shell commands, rather than running one script per file.'
  ].join(' '),
  claude: [
    'With Claude Code, prefer Read, Grep, and Glob to Bash for inspection; use Edit for existing files and Write only for new files.',
    'Bypass-permissions mode adds a note preferring Bash for reads, searches, and edits. It does not apply in ClosedAI: use the dedicated tools, which return less to carry forward and fail loudly on a bad edit, and keep Bash for work that is genuinely a command (builds, tests, git, processes).',
    'Independent calls belong in one response as several tool blocks: three files to read is one response carrying three Read calls, not three responses.'
  ].join(' '),
  antigravity: [
    'With Antigravity, prefer view_file, grep_search, and find_by_name to run_command for inspection; use replace_file_content or multi_replace_file_content for existing files and write_to_file only for new files.',
    'The CLI runs one tool step per model pass, so independent reads cost a pass each. When the targets are already known, read them together in a single run_command (for example a `sed -n` range per file) and group ClosedAI tool sequences with tool_batch; keep view_file for the one range you are about to edit.'
  ].join(' '),
  cursor: [
    'With Cursor, prefer the read, grep, and glob tools to shell commands for inspection; use the edit tools for existing files and write only for new ones.',
    'Independent calls belong in one model pass: issue the reads and searches you already know you need together rather than one per pass, and group ClosedAI tool sequences with tool_batch.'
  ].join(' ')
}

/** Shared engineering discipline plus the native tools available in one provider lane. */
export function engineeringInstructions(provider: ChatProvider): string {
  return [...COMMON_ENGINEERING_INSTRUCTIONS, PROVIDER_EDITING_INSTRUCTIONS[provider]].join('\n')
}
