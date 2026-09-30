# Model context

Source review: 2026-09-23. ClosedAI does not append provider-specific behavioral prompts beyond a
compact first-turn session guide (`closedai.guide`). The old shared instruction builders were
removed for a native-provider baseline. Regenerate the guide from `scripts/agent-guide-outline.json`
when orientation changes; `guide:check` guards drift. Product behavior lives in
[Application](application.md), and enabled tool contracts live in [Tools](tools.md).

## Provider baseline

| Provider | What ClosedAI sends at session start |
| --- | --- |
| Codex | `thread/start` or `thread/resume` with cwd, model settings, and the enabled tool catalog; no `developerInstructions` field. The first send on a new thread (and the first send after a handoff) may include `additionalContext.closedai.guide` (`kind: application`). |
| Claude Code | The SDK's native `claude_code` system preset with no ClosedAI append. Project `CLAUDE.md` can still load through the SDK's project settings source. The first send on a new session thread (and after a handoff) may include `closedai.guide` as a tagged user block ahead of the message. |
| Antigravity | The app-private `closedai` agent profile supplies the native tool grant and MCP inheritance required by this CLI. Its `agent.md` has no instruction body. The first send on a new conversation thread (and after a handoff) may include `closedai.guide` as tagged text ahead of the message. |
| Cursor | The ACP session receives enabled MCP server endpoints. Its adapter does not pass ClosedAI's `deferLoading` flag; Cursor controls discovery from the connected MCP servers. The first send on a new provider thread (and after a handoff) may include `closedai.guide` as a tagged block ahead of the message. |

These provider runtimes have their own native behavior and may load project policy through their
own mechanisms. Codex can load `AGENTS.md` natively. ClosedAI does not copy the selected
workspace's `AGENTS.md` into Claude, Antigravity, or Cursor prompts. Tool switches affect the
ClosedAI registry, not each provider's native tools.

The user controls ClosedAI tool switches in the Tools modal. Disabled tools and actions are
omitted from new tool catalogs and refused by the registry. Credential reads can also require an
in-chat approval card (Settings → Security). Claude Code and Codex do not show their native
permission or approval dialogs in ClosedAI sessions; capability is gated here instead. See
[Claude Code](claude-code.md#semantics) for the Claude SDK settings that enforce that boundary.
The app does not automatically switch every tool off as part of the prompt reset. Codex 0.154 may retain a saved tool catalog
on resume; when the enabled catalog changes, ClosedAI starts a new provider thread with its
existing conversation handoff before the next send. This preserves the visible transcript.
For a clean native baseline, use a new chat after loading the new build; an existing provider
thread can retain instructions from an earlier version.

## Turn data

`buildChatInput` validates user text and attachments, which provider adapters translate into
their native turn input. A browser-related message can receive a timestamped ambient active-tab
fragment from `buildTurnAdditionalContext`. It is labeled `untrusted` and marks relevance as
undetermined. Ambient tab metadata attaches only when the user asks about visible page content (current/open
page, read or summarize the page, and similar). It is omitted for chrome support (reload/fix
wording) and for generic browser mentions without that intent, so an unrelated open tab does not
steer public-fact or support turns toward scraping. Ordinary coding turns receive no automatic
browser snapshot.

A notepad window's chat instead receives `closedai.notepad` (`kind: untrusted`, `contextRole:
subject`) on every turn: the active note with numbered lines (whole up to 12,000 characters and 400
lines, else its first 120 lines with a pointer to `notes.read`), its revision, and the window's other
tabs by title and length. Sending pins the turn to that note, so `notes` tools that name no note
edit it even after the user switches tabs.

Explicit conversation continuation, branching, provider switching, project switching, and
session rotation may carry a handoff or compacted seed with a configurable soft target.
`chatHandoffTargetChars` defaults to 24,000 characters (0 includes all selected prose and
evidence references); full user requests, latest answer/plan, checkpoint, and changed paths
are protected even above the target. Older answers are selected whole, with recall ids for
omissions; available space includes evidence status references, not raw tool output or reasoning. Those fragments contain
historical user and assistant text; they are labeled untrusted and are not fresh user
instructions. Codex receives typed `additionalContext`; Claude, Antigravity, and Cursor receive
serialized `<closedai_context>` blocks. The serializer escapes embedded envelope markup so
quoted text cannot close its enclosing block. New chats without a continuation receive no
historical digest.

The session guide (`closedai.guide`, `kind: application`) is separate from handoffs: product
routing (user scope, search-first for public live facts, browser/app support when the session or
a pointed page matters), trust boundaries, recency expectations for external facts, and the default
verification guidance, including build/reload/restart boundaries and verification of the actual target surface.
Verification is proportional to the change and reuses valid results from the current work.
Repository navigation starts with filenames and scoped content searches; `.rgignore` excludes
generated workspace maps from default searches. The guide also calls out checks for new test
modules, map regeneration, and separate inspection and whitespace checks for untracked files.
Hygiene blocks dependency-layer violations; file sizes are advisory and leave structural choices
to the implementing model. Size-only growth requires no extra check or approval.
It is attached once per provider thread (including the first send after a handoff to a new thread), omitted on later turns in the same thread, and stripped from the user-visible transcript
like other context blocks. Edit `scripts/agent-guide-outline.json` and run `npm run guide:generate`;
`guide:check` guards drift.

`closedai.clock` (`kind: application`) is attached on **every** user turn with the host's calendar
date, local timestamp, UTC ISO time, and IANA timezone. Models should treat it as authoritative
"today" when deciding whether a question needs web lookup or freshness filters on `search.query`.
It is not injected into the user-visible transcript.

On coding-related turns (regex-gated for repo-work cues, or when the user names repo paths), ClosedAI may attach
`closedai.workspace.ledger` (`kind: untrusted`): host-verified paths from the current project
with content hashes, stale markers after re-read, and path hints from the prompt. The host fills
the ledger from completed `fileChange` rows and successful `test:one` commands in the transcript;
models must still re-read before citing semantics. Disable injection for A/B runs in **Tools &
capabilities** (**Workspace ledger** switch), or set `chatWorkspaceLedgerEnabled: false` in
`<userData>/app-settings.json` (default on). Takes effect on the next send; no restart required.

Saved credentials are never put into turn context. When enabled, the credential tools expose
masked metadata and scoped field reads; the registry redacts sensitive results from the Turn
Trace and persisted tool rows. The tool and security settings own their enforcement.

## Tool context and refresh

The registry supplies provider-neutral tool descriptions and schemas. Codex receives dynamic
tool specifications, Claude receives in-process MCP servers, and Antigravity and Cursor receive
HTTP MCP servers. File search and edits stay with each provider's native tools. Some tools are
deferred where the provider supports discovery; see [Tools](tools.md#how-the-model-sees-it).
On Codex, only a small eager set (typically `embedded_browser.page` and `closedai_app.state`)
ships full schemas on every turn; tools such as `search.query`, `tool_batch.run`, and the browser
CDP namespace load through discovery. Toggle **Task tool slices** in Tools & capabilities, or set `chatToolSliceEnabled` in app settings.
When it is on, `ensureCodexThread`
promotes a task slice from `scripts/tool-slices.json` (core, browser, research, or full) before
`thread/start`; a slice change rotates the thread like any other catalog drift. Trace label
`codex.tool_slice` records the slice id and promoted tool ids. On Cursor, the same flag selects a
slice for telemetry but always attaches every enabled MCP namespace at `session/new`.
Omitted ACP servers have no deferred discovery path, so task heuristics must not remove capabilities
or reopen a session solely because the selected slice changed. Trace label `cursor.tool_slice` records the slice id and namespace
set. On Claude Code, the flag promotes the slice's eager set through MCP `alwaysLoad`; a slice
change retires the idle CLI process so the next turn spawns with the new load set (ToolSearch
still reaches deferred tools). Trace label `claude.tool_slice` records the slice id and promoted
tool ids. On Antigravity, the flag writes the slice's eager tools into the CLI MCP config; a slice
change retires the idle `agy` process and re-registers config before the next spawn. Trace label
`antigravity.tool_slice` records the slice id and promoted tool ids. `measureToolContextBudget()`
in the main process guards eager wire size in tests.

**Provider parity target:** Cursor Composer in ClosedAI is the reference stack — full enabled
MCP tool schemas on the session plus the provider's native repository loop. Other lanes should
converge on the same *outcomes* (reliable routing to `closedai_app.*`, search, peer recall,
browser session tools, seamless rotation) through adapter-specific policy, not by copying Cursor's
transport. Registry changes should preserve Codex eager-wire regression budgets unless the owner
expands them deliberately.

Restart the application to load a changed main-process build. Use a fresh chat to evaluate a
prompt or native-provider baseline without earlier thread context. Tool switches may cause a
handoff on an existing chat, so a switched chat is not a clean baseline. The session guide is the
deliberate app-authored orientation layer; it does not replace provider-native behavior or tool
descriptions.

Chat naming is a separate, ephemeral task. Codex and Claude can receive a title-only request
after a completed exchange, with no ClosedAI tool registry or conversation continuation. Its
generated title is app metadata and is not inserted into the user's transcript as guidance.
