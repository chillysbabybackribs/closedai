# Cursor provider

The fourth chat provider: the user's Cursor subscription, reached through the `cursor-agent` CLI's
**Agent Client Protocol (ACP)** server. Ids carry a `cursor:` prefix; turn ids carry `cursor-turn-`.

Everything below was verified live against `cursor-agent 2026.09.02-c22c1a3` on 2026-09-03, on an
Ultra account. Where a claim came from a probe rather than the CLI's documentation, it says so.

## Why ACP, not `--print`

`cursor-agent` offers two headless surfaces. The one-shot path
(`--print --output-format stream-json`) spawns a process per turn and has two shapes that fight
the transcript: assistant events arrive as chunks **and then a full repeat** whose only
distinguishing mark is a missing `timestamp_ms`, and tool calls are a key-discriminated union
(`{readToolCall: {args, result}}`) needing a translator arm per tool.

`cursor-agent acp` is a **hidden** subcommand — "Start the Cursor Agent as an ACP (Agent Client
Protocol) server" — and is structurally the same thing as `codex app-server --listen stdio://`: one
long-lived process speaking newline-delimited JSON-RPC 2.0 over stdio. It gives clean text deltas,
normalised tool calls, in-protocol model and mode selection, real session history, and an interrupt.
So this adapter is built on ACP, and shares the Codex lane's transport
(`src/main/stdio-json-rpc.ts`).

Being hidden is the standing risk: a CLI version bump could remove or rename it. ACP itself is an
open protocol, so the wire format is not the fragile part — the subcommand's availability is.

## Semantics

| Concern | How it works |
|---|---|
| Model catalog | `session/new` reports `models.availableModels` (37 entries on Ultra). Never hardcoded. |
| Model ids | `<base>[<k>=<v>,…]`, e.g. `claude-opus-5[thinking=true,context=300k,effort=high,fast=false]`. |
| Reasoning effort | **None offered.** `session/set_model` accepts only a verbatim listed id; every bracket override was rejected with "Invalid model value", including efforts that `cursor-agent models` advertises. Effort is part of the model, so the picker shows one entry per model. |
| Model switching | `session/set_model` on the live session, so an open chat keeps its history — no respawn. |
| Chat history | `session/list` (agent-generated titles, `cwd`-scoped) and `session/load`, which replays the whole conversation as `session/update` notifications before resolving. The app records **no** transcript of its own, unlike the Antigravity lane. |
| Thread title | `session_info_update` carries a title the agent writes a turn or two in. |
| Interrupt | `session/cancel`; the session stays usable afterwards. |
| Approvals | `session/request_permission` is answered automatically with the broadest allow offered. This is narrower than the CLI's blanket `--force` and keeps ClosedAI's no-approval-dialog rule. |
| Archiving | ACP has no delete verb, so `cursor-archive.ts` keeps a local set of session ids the drawer stops listing. Cursor's own store is untouched. |
| Plan usage | Not reported. `cursor-agent about` names the tier only, so the hover card shows the plan with an explicit "unavailable" rather than an invented number. |
| Context usage | Not reported by ACP, so the pane shows no context gauge. |

## Client capabilities

`initialize` advertises `fs: { readTextFile, writeTextFile }` and **not** `terminal`. Without a
terminal the agent runs commands itself and reports them as `tool_call` updates, which is what the
transcript wants; advertising it would oblige us to implement a terminal only to proxy back to the
same machine.

Measured, not assumed: with `fs` advertised the agent still used its **own** read tool and reported
it as a `tool_call` rather than calling back to `fs/read_text_file`. Client-provided filesystem is
opportunistic — do not design as though all file IO routes through the app.

## Layout

| File | Responsibility |
|---|---|
| `cursor-cli.ts` | Binary resolution (`~/.local/bin/cursor-agent`), ACP argv, one-shot `about` for the account email and tier. |
| `cursor-acp.ts` | The ACP client on the shared stdio JSON-RPC transport: handshake, session verbs, and the requests the agent makes of its client. |
| `cursor-session.ts` | One pane's thread: the live process, the ACP session, the running turn, idle close, and `replay` for history. |
| `cursor-service.ts` | The `ChatProviderService` surface the hub routes to. |
| `cursor-stream.ts` | `session/update` → transcript operations. |
| `cursor-tool-items.ts` | ACP tool calls → the command / fileChange / tool vocabulary Codex items use. |
| `cursor-models.ts` | `availableModels` → the composer catalog. |
| `cursor-input.ts` | One user turn as ACP prompt blocks, including images (`promptCapabilities.image` is true). |
| `cursor-archive.ts` | The locally archived session ids. |
| `cursor-ids.ts` | `cursor:` prefix arithmetic, delegating to `src/shared/chat-providers.ts`. |

## Not done yet

- **Tools.** `session/new` takes `mcpServers` and the agent advertises `mcpCapabilities.http`, so
  the ClosedAI tool registry can be served per session over HTTP — with no global config file and
  no profile-key hashing, unlike the `agy` arrangement in `docs/antigravity.md`. The service
  already threads an `mcpServers` callback through to `session/new`; it currently returns `[]`.
  Serving it means extracting the HTTP/MCP core out of `antigravity-mcp.ts` rather than copying it.
- **Modes.** ACP reports `agent`, `plan`, and `ask` and accepts `session/set_mode`. The pane has no
  mode control, so the session stays on the agent default.
- **Slash commands.** `available_commands_update` lists the account's commands and skills; the pane
  has no surface for them, so the update is ignored.
- **`readThread` cost.** Reading another thread loads it on the same process. That is how ACP
  exposes history, but it means a cross-provider read starts a session on the agent's side.
