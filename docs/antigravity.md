# Antigravity provider

ClosedAI's chat has four providers behind one pane: Codex (the app-server, `src/main/chat-service.ts`),
Claude Code (the Claude Agent SDK, `src/main/claude/`), Antigravity (Google's `agy` CLI on the
user's Antigravity subscription, `src/main/antigravity/`), and Cursor (`cursor-agent` ACP,
`src/main/cursor/`). `src/main/chat-hub.ts` owns which one the
pane shows, merges their model catalogs into one picker, and routes every call by the id it carries
through `src/shared/chat-providers.ts`. Antigravity model ids and thread ids carry an `agy:` prefix
(`src/main/antigravity/antigravity-ids.ts`); Cursor ids carry a `cursor:` prefix.

Protocol observations were verified live against `agy` 1.1.24 on 2026-09-02. The CLI self-updates,
so those measurements retain their date. Application notes were reviewed against current source
on 2026-09-03 without a new live run. `ChatPeerManager` owns multiple project-scoped panes above
each pane's hub; see [Application](application.md).

Executable resolution uses `CLOSEDAI_ANTIGRAVITY_BIN`, then `~/.local/bin/agy` when installed,
then `agy` on `PATH` (`antigravity-cli.ts`).

## Why the CLI

The subscription is only reachable through Google's own clients. `agy` is the sanctioned headless one:
it authenticates from the credentials the Antigravity desktop app or a prior `agy` login cached under
`~/.gemini`, and the app never sees or stores a Google token. The proxy projects that extract the
desktop app's OAuth client and call the internal endpoint directly are deliberately not used.

## Semantics

- **A thread belongs to a provider.** Picking an Antigravity model switches the pane to its current
  conversation; the old thread stays in history. Opening a thread from history switches to its
  provider. Switching is refused while a turn runs.
- **Sign-in is per provider.** `agy models` at startup both fills the catalog and proves the sign-in;
  an authentication failure shows the pane's sign-in message (run `agy` in a terminal and complete the
  Google login), and choosing an Antigravity model re-checks. The listing is shared per workspace
  through the provider catalog cache (`chat-context/provider-catalog-cache.ts`, persisted in
  `provider-catalogs.json`): a pane whose workspace read it within ten minutes becomes ready without
  spawning `agy models`, and a pane that is not on Antigravity fills the picker from the cache — at
  any age, across relaunches — without starting the provider at all.
- **No approval prompts**, matching the other lanes: `--dangerously-skip-permissions` (without it the
  init event reports `permission_mode: request-review` and a headless turn stalls on a prompt nobody
  answers).
- **Models** come from `agy models`, never a hardcoded list: the CLI drops ids between versions and a
  dropped id fails a turn instantly. Effort is baked into the CLI's ids (`gemini-3.8-flash-high`), so
  the picker shows one entry per family and the shared effort control chooses the suffix
  (`antigravity-models.ts`). Families without a suffix (the Claude models) take no effort. Effort and
  model are spawn-time flags, so a change takes effect with the next process.
- **Tools** are the shared registry, served to the CLI over MCP (`antigravity-mcp.ts`, below). The
  model sees `mcp_embedded_browser_page` where Claude sees `mcp__embedded_browser__page`. Every call
  runs through `ToolRegistry.call`, so validation, timeouts, telemetry, and the Tools modal's switches
  apply. Namespaces are registered with the CLI when the bridge starts; a namespace switched on later
  is advertised after the next app launch.
- **The custom agent** (`antigravity-profile.ts`) is written under `<userData>/antigravity/profile` and
  reaches the CLI as an extra `--add-dir` plus `--agent closedai`. Its frontmatter `tools:` list is the
  agent's native tool grant (files, search, shell, tasks). Without it a `--agent` run keeps only a
  read-only set and the model narrates diffs instead of editing. A `PreToolUse` hook denies the CLI's
  own browser, web-fetch, search, and image tools with a steer to the ClosedAI equivalents, because
  those drive a browser the user cannot see and carry none of their sessions.
- **Shared application voice and context.** The agent includes the common application,
  articulation, and engineering contracts: project-scoped panes, one shared browser, app/tool
  routing, concise result-led messages, native focused read/edit tools, narrow verification, and
  preservation of Git state. ClosedAI also appends the selected workspace root's bounded
  `AGENTS.md` policy because the CLI exposes no equivalent loading contract; nearer nested policies
  are read before editing beneath them. Provider-specific grants remain here.
- **File links without re-verification.** The CLI's built-in Communication section demands a
  clickable `file://` link, anchored `#L10-L20` in its example, for every file and symbol. Measured
  2026-09-03, gemini-3.8-flash obeyed it by opening files whose paths it already had, just to mint
  line numbers, and re-verified the repository map (5 to 13 calls where every other model made 0).
  The agent therefore says to satisfy the link rule from known paths without an anchor, to add an
  anchor only for a line actually read this turn. Repository maps are no longer injected;
  file discovery uses the native file tools.
  The profile is refreshed on provider connection and loaded by a new CLI process; changing
  documentation alone does not update an already running agent. See [Model context](model-context.md).
- **No context gauge.** `agy` reports token usage per step but no context window, and the transcript
  shows a gauge only with a denominator.
- **Subscription plan usage.** `agy -p "/quota" --output-format json` reports 5-hour and weekly rolling
  buckets for Gemini and third-party models with exact reset timestamps, surfaced on the composer's usage
  card (`antigravity-service.ts`, `plan-usage.ts`). The reading is shared across panes and reused for
  60 seconds (`ANTIGRAVITY_QUOTA_REUSE_MS`): start-up, hover, and turn end all ask for it, but only
  spawn the two-second `agy` process when the shared reading is older than that.
- **Re-seed compaction.** `agy` has no native compact verb, so the app can drop the CLI conversation
  handle and inject a bounded transcript summary on the next turn (`compactConversation` on the pane,
  button in the usage card). The visible transcript is unchanged; only provider-side context shrinks.
  Same strategy as the Cursor lane's re-seed compaction in AppV1.
- **MCP primer turn.** A freshly spawned `agy` process runs one internal READY turn before the user's
  prompt so eager MCP declarations load off the send path (`antigravity-session.ts`).
- **Empty-success recovery.** When the CLI reports SUCCESS without final assistant text, the session
  sends one internal recovery prompt on the same process before surfacing a notice.
- **Cache telemetry.** Per-turn usage with zero `cache_read_tokens` on large prompts is recorded in the
  turn trace as a cache anomaly (`antigravity-cache-diagnostics.ts`).

## Process lifecycle (`antigravity-session.ts`, `antigravity-process.ts`)

One `agy --print= --input-format stream-json --output-format stream-json` process per live thread.
Turns go in as one JSON line each (`{"event":"user","message":{"role":"user","content":…}}`); the
process stays alive across turns on one conversation, is closed after 15 idle minutes, and the next
turn resumes the conversation in a fresh process with `--conversation <id>`. `--print=` with an
empty value is load-bearing: a bare `--print` swallows the next flag as its prompt.
The outer pane manager can park an unselected pane after five idle minutes, before the
provider's 15-minute timer. Its conversation id remains available for resumption.

`--add-dir <workspace>` must be passed and must come first. The spawn cwd alone does not reach the
model's shell, which otherwise starts in the CLI's state dir; the first `--add-dir` does.

There is no interrupt in the protocol. Stopping a turn kills the process group (TERM, then KILL
after three seconds) so shell commands the CLI forked stop too; the conversation resumes later.

## Stream (`antigravity-stream.ts`)

Events are `{"event": <kind>, <kind>: {…}}`. `init` carries the conversation id; `step_update`
carries every step (`user_input`, `agent_response` with `text_delta`, `tool` with
`tool_info{name, parameters, output, error}`, ACTIVE then DONE or ERROR); `result` closes the turn
with a status and the final `response`. The delta stream is not a reliable transcript (a one-word
reply streamed only a newline), so the last assistant item is repaired from `result.response`.
`result` arrives a few seconds after the last step.
Native tool outputs are retained in normalized activity items for the shared step-list display.
Screenshot items prefer the larger retained display capture when the store still has it.

## MCP bridge (`antigravity-mcp.ts`)

The HTTP listener, the per-namespace MCP servers, the registry dispatch, and the call ledger are
the shared `src/main/tools/mcp-http-bridge.ts`, which the Cursor lane also uses (`docs/cursor.md`).
What stays here is Antigravity's own: the registration written into the CLI's MCP config, and
reading a call's conversation id off its `_meta`. Because that registration is
global there is no per-session URL to carry a caller key, which is why this lane keys calls by
`_meta` where Cursor keys them by path.


The main process hosts one streamable-HTTP MCP endpoint per enabled namespace on
`127.0.0.1:<random port>/mcp/<namespace>` (MCP SDK 1.30). The CLI POSTs `initialize` and then opens a
standalone GET SSE stream, so the transport is stateful (one per `mcp-session-id`). Registration is
global, in `~/.gemini/config/mcp_config.json`. The bridge writes its entries there itself in one
pass — `{serverUrl, tools: {<name>: {eager: true}}}` per namespace, the same shape `agy mcp add
--type http` plus `agy mcp enable` produce, with the eager map that keeps tools out of the generic
`call_mcp_tool` gateway. It used to run those two verbs per namespace: sixteen `agy` processes of a
second or more each on every first Antigravity start, which was most of what switching to
Antigravity cost. The entries are removed at quit by editing the file the same way (the CLI does
not rewrite it on exit, verified). While the app runs, a standalone `agy` session also sees the
servers, which is harmless.

The config is one file for every app instance. The default profile registers bare namespace names;
any other profile (a second checkout, a headless test run with its own `--user-data-dir`) suffixes a
stable hash of its userData path (`embedded_browser_1k2j9x`), so it never redirects the user's running
app at its own bridge. The stream translator maps server names back to namespaces for the labels.

Each `tools/call` carries `_meta['antigravity.google/conversation_id']`. The service binds
conversation ids to its pane and turn as soon as the init event names one, and that binding becomes
the registry's call context. Completed calls are recorded per conversation so the transcript can
attach the app's retained display capture to the matching `closedai_ui · capture` row.

## History (`antigravity-history.ts`)

Conversations live in the CLI's store (`~/.gemini/antigravity-cli`): one SQLite file of protobuf steps
per conversation, and `conversation_summaries.db` with the title the CLI generates, a preview,
timestamps, and the workspaces the conversation was added to. The app lists that table for its
workspace (top-level conversations only). The steps are opaque, so the app saves its own copy of each
conversation's transcript under `<userData>/antigravity/transcripts` after every turn and shows it
when a thread is reopened; a conversation this app never showed reopens empty with a notice. The CLI
has no tag or delete verb, so archiving is an app-side set.

## Not done yet

- Pasted images are written to `<userData>/antigravity/attachments` and listed by path for the
  model's `view_file`; whether the current models read them there has not been verified.
- Thread names arrive from the CLI's title generator a moment after the first turn; the pane polls
  once two seconds after each turn.
