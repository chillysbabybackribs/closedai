# Agent run access: what each provider can enforce (2026-10-02)

Status: investigation only. No access setting exists in the app. The agent builder shows limits
and autonomy, which the main process enforces itself; it shows no access control, because a switch
that only adds a sentence to the prompt would look like a guarantee and be a request.

The question: can one agent run be given less than full access (read-only, edits inside the
project folder only, no shell, no browser tools, no acting on other chats), enforced by the app or
the provider and not merely stated in the standing instructions?

Evidence is from reading this checkout and the installed CLIs' `--help` output. Nothing below was
exercised against a live provider session, so each "enforceable" is a mechanism that exists, not a
behavior that was observed.

## What a run's access consists of

A run's chat can act through three separate paths, and a restriction has to close all three:

1. The provider's own tools: file edits and the shell.
2. ClosedAI's tools (`src/main/tools/`), which run in the Electron main process. No provider
   sandbox covers them.
3. The shell reaching ClosedAI's tools directly. An agent with an unrestricted shell can read
   `~/.gemini/config/mcp_config.json` (the Antigravity bridge URL and token) and call the bridge
   without a pane identity. Tool restrictions hold only when the shell is also denied or sandboxed
   and calls with no pane are refused.

## By provider

| | Read-only files | Writes only inside the project folder | No shell | No browser / no acting on other chats |
|---|---|---|---|---|
| **Codex** | Enforceable: `sandbox: 'read-only'` in `sharedThreadParams` (`src/main/chat-context/thread-params.ts`), used by all three thread callers. `codex exec --help` lists `read-only`, `workspace-write`, `danger-full-access`. | Enforceable: `workspace-write`, same place. | Not found: no switch turns the shell off; under `read-only` it still runs read commands. Instruction only. | Enforceable in the tool registry (below); calls arrive with a fixed pane id (`app-server-tools.ts`). |
| **Claude** | Partly: `disallowedTools` removes tools from the model's context (SDK types: "cannot be used, even if they would otherwise be allowed"); the app already removes `AskUserQuestion` this way under `bypassPermissions`. Denying the edit tools is not enough while Bash can write. | Unknown: needs a non-bypass permission mode with edit rules plus the SDK `sandbox` option (bubblewrap is installed). Not tried, and `settingSources` project/user rules could widen it. | Enforceable: `disallowedTools: ['Bash']`. Subagent and background-task tools were not checked. | Enforceable in the tool registry; the pane id is a closure per pane (`claude-service.ts`). |
| **Antigravity** | In principle: a second agent profile without write tools, selected with `--agent` (`antigravity-profile.ts` says the `tools:` list is the grant). `--mode plan` exists; its semantics were not verified. | Unknown: `--sandbox` says only "terminal restrictions"; no path scope in `--help`. | In principle: a profile without `run_command`. | Weak: MCP registration is one global config file, so tools cannot be hidden per pane, and an unbound call falls back to "the one pane with a turn running" or no pane (`mcp-http-bridge.ts`). |
| **Cursor** | Unknown: ACP reports `plan` and `ask` modes and accepts `session/set_mode` (`docs/cursor.md`), which the app never sends. | Unknown: `--sandbox enabled` is a top-level flag; whether it applies to `acp` is unverified. | Unknown. | Enforceable in the tool registry if the pane binding precedes the first call; MCP servers are passed per pane at `session/new`. |

## ClosedAI's own tools

Every provider's tool call goes through `ToolRegistry.call` (`src/main/tools/registry.ts`), where
the calling pane and the `tool.action` id are both in scope, next to the existing "switched off in
the Tools panel" check. A per-pane deny fits there. Two things are missing:

- There is no per-action record of which actions mutate. `READ_ONLY_TOOL_IDS`
  (`src/main/tools/catalog.ts`) is per tool and counts `embedded_browser.page` as read-only
  although it navigates. A table is needed for `closedai_app.command` (`send_message`,
  `close_chat`, `new_chat`, `stop_agent`, `open_chat`, `select_model`, `browser_tab`,
  `project_switch`), `closedai_app.agent` (`start`, `pause`, `resume`, `stop`), `closedai_app.ui`,
  `closedai_app.menu`, `notes`, `credential_vault.read`, `media.video`, and the mutating browser
  and CDP verbs.
- The policy must refuse a call whose pane is unknown, which today is allowed through.

## Session lifetime

- The run record is written before the first cycle is sent, so a provider that builds its session
  at first send (Codex, Antigravity) would see the run's level.
- Claude and Cursor are warm-started when the chat is created (`peer-manager.ts` `wakeLater`,
  `claude-service.ts`, `cursor-service.ts`), which is before the run exists. Their session would
  have to be retired and rebuilt when a run attaches.
- A model can start a run on a pane that already has a live session
  (`closedai_app.agent start`), so the same rebuild is needed there.
- Stopping a run nulls the record and tells no provider. A narrowed session would stay narrowed on
  an ordinary chat until it happened to be rebuilt, so stop has to rebuild it too.
- Rotation and resume go back through the same builders; the level has to be read there every time.
- Codex answers every approval request with accept (`chat-approvals.ts`); that must become deny
  if the approval policy ever leaves `never`.

## Why this stopped at the investigation

Compared with the rest of the agent builder (shared contracts, one service, one dialog screen),
enforcement touches four provider lanes, the tool registry, a new classification of every
mutating tool action, and session rebuild logic on attach, stop, and rotation, in service files
that are already at or near the size threshold. It also needs a live check per provider and per
level before any switch can honestly say "enforced", and those checks need the app restarted
with the change.

## A design that would be honest

1. One setting, three levels: read-only, project folder, full. Offer a level for a provider only
   where every path above is closed for it; otherwise do not show the level for that provider.
2. Start with Codex, where the provider sandbox maps onto the levels directly, plus the registry
   policy for ClosedAI's tools. Verify live: a write under `read-only`, a write outside the folder
   under `workspace-write`, and a denied `send_message`.
3. Claude next: read-only as `disallowedTools` for the edit tools and Bash, with the session
   rebuilt on attach and stop. Project-folder writes only after the sandbox option is proven.
4. Antigravity and Cursor stay at full access until their mechanisms are verified, and the
   builder says so when the launching chat uses one of them.
5. Separate switches for the shell, the browser, and other chats follow from the same registry
   policy once the per-action table exists; "no shell" is enforceable on Claude only.
