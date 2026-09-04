# Claude Code provider

Each ClosedAI chat pane has four providers: Codex (the app-server), Claude Code (the Claude
Agent SDK), Antigravity (`agy`), and Cursor (`cursor-agent` ACP). `src/main/chat-hub.ts` routes one pane and merges its model
catalogs; `src/main/chat-peers/` manages the project's pane set. Claude model and thread ids use
`claude:`, Antigravity uses `agy:`, Cursor uses `cursor:`, and Codex ids are unprefixed. See [Application](application.md).

The SDK protocol observations were verified live against `@anthropic-ai/claude-agent-sdk`
0.3.258 on 2026-09-02. The package is pinned exactly and ships its CLI. Application lifecycle
and transcript notes were reviewed against current source on 2026-09-03, without a new live run.

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
  The SDK does not load `AGENTS.md`, so ClosedAI appends the selected workspace root's bounded
  `AGENTS.md` policy explicitly and tells the model to check for nearer nested policies.
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

- **Grep and Glob are requested explicitly** (`allowedTools: ['Grep', 'Glob']`): native Claude
  Code builds otherwise omit them and route every search through Bash (SDK `tools` docs). Verified
  2026-09-03: without the option the `init` tool list had no Grep/Glob, which is why the app's
  panes had made 0 such calls in 2,018 tool calls; with it both appear and the model uses them.
  There is no MultiEdit tool in this CLI, so instructions name only Edit.
- **Native reads** (revised 2026-09-04): ClosedAI no longer installs read-ledger hooks. The SDK
  handles `Read` directly, including repeated reads, without app denial, range rewriting, or
  `closedai_read` output injection. Source-version observations now come only from the shared
  workspace tools, consistently across providers. This removes app-side duplicate file reads and
  coverage bookkeeping; it does not establish a measured change in model latency or token use.

## Process lifecycle (`claude-session.ts`, `claude-runtime.ts`)

One `query()` per live thread over a streaming input, so follow-up turns reuse the process and its prompt
cache. A warm connection or the first turn starts the process (with `resume` when continuing a
stored session). It stays across turns and closes after 15 idle minutes when no tracked background
task is running; the next turn resumes in a fresh process. A cold catalog read can reuse the
workspace's signed-in catalog/account cache for ten minutes (`claude-catalog.ts`); otherwise it
spawns to query the SDK and retires again. Signed-out reads are not cached, and connection errors
invalidate the cache. The outer pane manager parks unselected idle panes after five minutes;
see the lifecycle boundary below.

`claude-instructions.ts` appends the shared application, articulation, and engineering contracts
to the SDK preset. Its engineering clause names Claude's native read/edit tools and prevents shell
rewrites, broad verification, and Git stash mutation by default. Updated prompt source is loaded by
a new main-process build and query runtime. See
[Model context](model-context.md).

Nonessential CLI traffic is left enabled on purpose: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` also
disables the session titles the history shows (verified live: with it set, `summary` stays the raw
prompt). Every process carries `CLOSEDAI_CLAUDE_RUNTIME_ID` in its environment. Closing a runtime ends the input,
closes the query, and then TERM/KILLs every Linux process still carrying that id
(`claude-process-tree.ts`): a turn's "active" flag is not process ownership, since Bash and subagent work
can outlive a turn or be reparented.

## History (`claude-history.ts`)

The SDK's session store is the history. `listSessions({ dir: cwd, includeProgrammatic: true })` lists
threads (the CLI titles them itself after the first turn; title lookup runs at turn end and retries
an unnamed session after successive delays of 3, 8, and 20 seconds),
`getSessionMessages` replays a session through the same translator that renders live turns, and
archiving tags the session (`closedai-archived`) rather than deleting it. `app-settings.json` keeps
`chatClaudeSessionId` alongside per-pane `claudeSessionId` records. `PeerSettings` scopes each
runtime to its pane; the outer manager retains display titles even while panes are dormant.

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
(larger display copy from the store when it is still held).

Context usage is the last request's prompt size (`input + cache_read + cache_creation` from
`message_start`) over the resolved model's `contextWindow` from `result.modelUsage`. `modelUsage` has one
entry per model the turn touched (the CLI's title generation runs on Haiku), so the window is matched by
model id, never taken from the first entry. Compaction is the CLI's own; a `compact_boundary` shows as
a notice. ClosedAI explicitly enables Claude's native auto-compaction and precomputes its summary; after
each completed turn it also asks the SDK for its lightweight context summary, using the stream result as
a fallback for older or shutting-down runtimes.

### Background work

`claude-background-tasks.ts` is session-owned, shared across per-turn translators. SDK
`task_started`, `task_progress`, and `task_notification` system messages upsert one task item by
task id, retaining its originating turn and linked tool id. Ambient/skip-transcript tasks are
hidden. Completion after `result` updates the same item; later assistant output can open an
autonomous turn. Retiring or losing the session marks tracked unfinished tasks stopped.

The renderer groups background work separately and keeps running tasks visible across new user
messages. Completed tasks stay in the current status indicator until the next user message.
This is distinct from peer-pane control. The session's idle close respects running tasks, but
the outer pane manager's parking, retirement, and project-switch checks use `activeTurnId`, so
they can still stop work that outlives its turn. See [known boundaries](application.md#known-boundaries-from-this-source-review).

## Gates

`scripts/closure-gate.mjs` allowlists `@anthropic-ai/claude-agent-sdk` and `zod` (the SDK's `tool()` helper
takes Zod shapes; `claude-schema.ts` imports the registry's JSON Schema with `z.fromJSONSchema`) and
sanctions `src/main/claude/` beside `src/main/tools/`. The SDK is loaded with a dynamic import on first
use and externalized from the main bundle (`externalizeDepsPlugin`), so it never touches startup.
