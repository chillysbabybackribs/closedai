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
undetermined. Ordinary coding turns receive no automatic browser snapshot.

Explicit conversation continuation, branching, provider switching, project switching, and
session rotation may carry a bounded handoff or compacted seed. Those fragments contain
historical user and assistant text; they are labeled untrusted and are not fresh user
instructions. Codex receives typed `additionalContext`; Claude, Antigravity, and Cursor receive
serialized `<closedai_context>` blocks. The serializer escapes embedded envelope markup so
quoted text cannot close its enclosing block. New chats without a continuation receive no
historical digest.

The session guide (`closedai.guide`, `kind: application`) is separate from handoffs: product
routing, trust boundaries, recency expectations for external facts, and the default verification
ladder. It is attached once per provider thread (including the first send after a handoff to a new
thread), omitted on later turns in the same thread, and stripped from the user-visible transcript
like other context blocks. Edit `scripts/agent-guide-outline.json` and run `npm run guide:generate`;
`guide:check` guards drift.

`closedai.clock` (`kind: application`) is attached on **every** user turn with the host's calendar
date, local timestamp, UTC ISO time, and IANA timezone. Models should treat it as authoritative
"today" when deciding whether a question needs web lookup or freshness filters on `search.query`.
It is not injected into the user-visible transcript.

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
CDP namespace load through discovery. `measureToolContextBudget()` in the main process guards
that eager wire size in tests.

Restart the application to load a changed main-process build. Use a fresh chat to evaluate a
prompt or native-provider baseline without earlier thread context. Tool switches may cause a
handoff on an existing chat, so a switched chat is not a clean baseline. The session guide is the
deliberate app-authored orientation layer; it does not replace provider-native behavior or tool
descriptions.

Chat naming is a separate, ephemeral task. Codex and Claude can receive a title-only request
after a completed exchange, with no ClosedAI tool registry or conversation continuation. Its
generated title is app metadata and is not inserted into the user's transcript as guidance.
