import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { CLAUDE_RUNTIME_ID_ENV } from './claude-process-tree.js'

// The one place the app's Claude Code session shape is decided. Every choice here was verified
// live against SDK 0.3.258 on 2026-09-02 (see docs/claude-code.md):
// - bypassPermissions + allowDangerouslySkipPermissions: ClosedAI never shows approval prompts,
//   matching the Codex thread's approvalPolicy 'never' / danger-full-access.
// - settingSources ['project']: the workspace's CLAUDE.md and .claude/settings.json apply (the
//   Codex lane reads AGENTS.md natively); the user's ~/.claude settings never leak into the app.
// - strictMcpConfig: only ClosedAI's in-process tool servers, never the user's own connectors.
// - thinking display 'summarized': without it thinking blocks stream with empty text on every
//   current model, and the transcript's reasoning items would be blank.
// - AskUserQuestion is removed: there is no UI for it, so the model asks in its final message.

export const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ClaudeEffortLevel = (typeof CLAUDE_EFFORT_LEVELS)[number]

export const CLAUDE_DISALLOWED_TOOLS = ['AskUserQuestion']

export type ClaudeQueryConfig = {
  cwd: string
  /** SDK `model` value (e.g. `opus[1m]`), or null for the CLI's account default. */
  model: string | null
  effort: string | null
  adaptiveThinking: boolean
  /** Session id to resume; null starts a fresh session. */
  resume: string | null
  /** Inherited by every process the session spawns; see claude-process-tree.ts. */
  runtimeId: string
  mcpServers: NonNullable<Options['mcpServers']>
  systemPromptAppend: string
  env?: NodeJS.ProcessEnv
  stderr?: (data: string) => void
}

export function claudeEffortLevel(value: string | null | undefined): ClaudeEffortLevel | null {
  return CLAUDE_EFFORT_LEVELS.find((level) => level === value) ?? null
}

export function claudeQueryOptions(config: ClaudeQueryConfig): Options {
  const effort = claudeEffortLevel(config.effort)
  return {
    cwd: config.cwd,
    ...(config.model ? { model: config.model } : {}),
    ...(effort ? { effort } : {}),
    ...(config.adaptiveThinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
    ...(config.resume ? { resume: config.resume } : {}),
    // Keep context management inside Claude Code, and prepare its summary before the window is
    // full so the next user turn does not pay the entire compaction cost on the critical path.
    settings: {
      autoCompactEnabled: true,
      precomputeCompactionEnabled: true
    },
    env: {
      ...(config.env ?? process.env),
      [CLAUDE_RUNTIME_ID_ENV]: config.runtimeId,
      // Nonessential traffic is left on deliberately: the switch that disables it also
      // disables the CLI's session titles, which the chat history shows (verified live).
      CLAUDE_AGENT_SDK_CLIENT_APP: 'closedai/0.1.0'
    },
    includePartialMessages: true,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: ['project'],
    strictMcpConfig: true,
    disallowedTools: CLAUDE_DISALLOWED_TOOLS,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: config.systemPromptAppend },
    mcpServers: config.mcpServers,
    ...(config.stderr ? { stderr: config.stderr } : {})
  }
}
