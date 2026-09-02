# Claude Code provider

ClosedAI's chat has two providers behind one pane: Codex (the app-server, `src/main/chat-service.ts`)
and Claude Code (the Claude Agent SDK, `src/main/claude/`). `src/main/chat-hub.ts` owns which one the
pane shows, merges their model catalogs into one picker, and routes every call by the id it carries.
Claude model ids and thread ids carry a `claude:` prefix (`src/main/claude/claude-ids.ts`); Codex ids
never contain a colon.

Everything below was verified live against `@anthropic-ai/claude-agent-sdk` 0.3.258 (pinned exactly:
the package ships the CLI binary, so the two cannot drift) on 2026-09-02.

## Semantics

- **A thread belongs to a provider.** Picking a model from the other provider switches the pane to that
  provider's current thread; the old thread stays in history. Opening a thread from history switches to
  its provider. Switching is refused while a turn runs.
- **Sign-in is per provider.** Codex signs in with ChatGPT from the app. Claude Code signs in from its own
  CLI (`claude`, then `/login`); the pane shows how, and choosing a Claude model re-checks.
- **No approval prompts**, matching the Codex lane: `permissionMode: 'bypassPermissions'` with the
  required `allowDangerouslySkipPermissions`. `AskUserQuestion` is disallowed (no UI for it); the system
  prompt tells the model to ask in its final message.
- **Settings isolation.** `settingSources: ['project']` loads the workspace's `CLAUDE.md` and
  `.claude/settings.json` only; the user's `~/.claude` settings never shape an app session.
  `strictMcpConfig: true` keeps the user's own MCP connectors (claude.ai connectors were observed
  loading without it) out of the session.
- **Tools** are the shared registry, exposed as one in-process MCP server per namespace
  (`claude-tools.ts`). The model sees `mcp__embedded_browser__page` where Codex sees
  `embedded_browser.page`. Every call runs through `ToolRegistry.call`, so validation, timeouts,
  telemetry, and the Tools modal's switches apply. SDK MCP tools are deferred behind `ToolSearch` by
  default; ClosedAI passes `alwaysLoad` unless the registry marks a tool `deferLoading`. The MCP request
  metadata carries the model's tool_use id (`_meta['claudecode/toolUseId']`), which becomes the call id,
  the transcript item id, and the screenshot store key. Switches toggled in the Tools modal apply to
  calls immediately and to what is advertised when the next Claude process starts (new chat, or after
  the idle close).
- **Thinking** is requested with `display: 'summarized'` on models that support adaptive thinking.
  Without it every current model streams thinking blocks with empty text and the reasoning items would
  be blank. Haiku 4.5 reports no adaptive thinking and gets no thinking option.
- **Effort** defaults to `high` when no option is sent (verified through a PreToolUse hook, with settings
  isolated). The picker persists `chatReasoningEffort` and applies it live through
  `Query.applyFlagSettings({ effortLevel })`; the model applies live through `Query.setModel`.
- **Models** come from `Query.supportedModels()` at startup, never a hardcoded list: aliases of one model
  collapse (`default` and `opus[1m]` both resolve to `claude-opus-5[1m]`), the CLI's default is the
  picker default, and each entry's `supportedEffortLevels` feeds the effort picker.

## Process lifecycle (`claude-session.ts`, `claude-runtime.ts`)

One `query()` per live thread over a streaming input, so follow-up turns reuse the process and its prompt
cache. The process is spawned on the first turn (with `resume` when the thread continues a stored
session), kept across turns, and closed after 15 idle minutes; the next turn resumes the same session
in a fresh process. At startup the provider spawns once to read the catalog and account, and closes it
again unless Claude is the active provider.

Every process carries `CLOSEDAI_CLAUDE_RUNTIME_ID` in its environment. Closing a runtime ends the input,
closes the query, and then TERM/KILLs every Linux process still carrying that id
(`claude-process-tree.ts`): a turn's "active" flag is not process ownership, since Bash and subagent work
can outlive a turn or be reparented.

## History (`claude-history.ts`)

The SDK's session store is the history. `listSessions({ dir: cwd, includeProgrammatic: true })` lists
threads (the CLI titles them itself after the first turn; the header picks the title up at turn end),
`getSessionMessages` replays a session through the same translator that renders live turns, and
archiving tags the session (`closedai-archived`) rather than deleting it. `app-settings.json` keeps
`chatClaudeSessionId`, resumed on startup like `chatThreadId` for Codex.

## Transcript (`claude-stream.ts`, `claude-tool-items.ts`)

Stream contracts the translator relies on: `system/init` carries the session id and resolved model; text,
thinking, and tool_use blocks arrive as `content_block_start` → deltas → `content_block_stop`, then the
whole `assistant` message restates them (restated blocks match streamed items by content so nothing
duplicates); tool_use input streams as partial JSON and parses at stop; `user` messages carry
`tool_result` blocks keyed by tool_use id; `result` closes the turn. `terminal_reason`
`aborted_streaming` / `aborted_tools` means the user stopped the turn (a notice, not an error).

Tool mapping: `Bash` → command; `Edit` / `MultiEdit` / `Write` / `NotebookEdit` → file change with a
`-`/`+` diff; `TodoWrite` / `TaskCreate` / `TaskUpdate` → plan; `Read`, `Glob`, `Grep`, `WebSearch`,
`WebFetch`, `Task`, `ToolSearch`, `Skill` → labelled tool rows; `mcp__<namespace>__<tool>` → the
`namespace · tool` label Codex MCP calls use; a `closedai_ui · capture` result with an image → screenshot
(full-resolution copy from the store when it is still held).

Context usage is the last request's prompt size (`input + cache_read + cache_creation` from
`message_start`) over the resolved model's `contextWindow` from `result.modelUsage`. `modelUsage` has one
entry per model the turn touched (the CLI's title generation runs on Haiku), so the window is matched by
model id, never taken from the first entry. Compaction is the CLI's own; a `compact_boundary` shows as
a notice.

## Gates

`scripts/closure-gate.mjs` allowlists `@anthropic-ai/claude-agent-sdk` and `zod` (the SDK's `tool()` helper
takes Zod shapes; `claude-schema.ts` imports the registry's JSON Schema with `z.fromJSONSchema`) and
sanctions `src/main/claude/` beside `src/main/tools/`. The SDK is loaded with a dynamic import on first
use and externalized from the main bundle (`externalizeDepsPlugin`), so it never touches startup.
