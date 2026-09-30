# Cursor provider

The fourth chat provider: the user's Cursor subscription, reached through the `cursor-agent` CLI's
**Agent Client Protocol (ACP)** server. Ids carry a `cursor:` prefix; turn ids carry `cursor-turn-`.

Everything below was verified live against `cursor-agent 2026.09.02-c22c1a3` through 2026-09-21, on an
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
| Model catalog | `session/new` reports `models.availableModels` (37 entries on Ultra). Never hardcoded. A pane reuses the workspace's cached reading (`provider-catalogs.json`) when it is fresh, so an ordinary start opens no process at all. |
| Starting a pane | Measured 2026-09-04 against 2026.09.02-c22c1a3: the ACP handshake is ~1s, `session/new` ~1.5s, `session/load` ~0.45s, and `cursor-agent about` ~1.45s. Only the work the pane actually needs is on the path to `ready`: the catalog comes from the cache when it can, the account is read behind the ready state, and the pane's saved session is what any open loads. |
| Session identity | The pane's saved session id is seeded into the thread before anything opens, so warming loads that session instead of creating one next to it. Keying the resume on the session id instead of the transcript is what used to abandon the conversation on every relaunch and leave untitled, unloadable sessions in `session/list`. |
| Model ids | `<base>[<k>=<v>,…]`, e.g. `claude-opus-5[thinking=true,context=300k,effort=high,fast=false]`. |
| Reasoning effort | **None offered.** The advertised model config accepts only a verbatim listed id; every bracket override was rejected with "Invalid model value", including efforts that `cursor-agent models` advertises. Effort is part of the model, so the picker shows one entry per model. |
| Model switching | `session/set_config_option` with the session-advertised `category: "model"` config id, so an open chat keeps its history — no respawn. The older experimental `session/set_model` can reject a loaded session with `Invalid params`. |
| Chat history | `session/list` (agent-generated titles, `cwd`-scoped) and `session/load`, which replays the whole conversation as `session/update` notifications before resolving. Replay retains the returned session setup so continuing that session reuses the load. Startup restores saved history before checking for an uncached catalog, obtaining both from one load. The app records **no** transcript of its own, unlike the Antigravity lane. |
| Thread title | `session_info_update` is ignored: cursor-agent titles from the start of the first prompt, which is always app context (clock, session guide). The pane titles itself from the first message and the app's generated title, like the other lanes (2026-09-29). |
| Interrupt | `session/cancel`; the session stays usable afterwards. |
| Approvals | `session/request_permission` is answered automatically with the broadest allow offered. This is narrower than the CLI's blanket `--force` and keeps ClosedAI's no-approval-dialog rule. |
| Tools | The ClosedAI registry is served over MCP by the shared HTTP bridge (`src/main/tools/mcp-http-bridge.ts`), passed to `session/new` as `mcpServers`. Each pane's endpoints carry the bridge's per-launch token and its own key (`/mcp/<token>/<key>/<namespace>`), so a served call is attributed to that pane and turn exactly; a request without the token, with a Host that is not this loopback listener, or with an Origin header is refused. |
| Product instructions | ClosedAI adds no first-turn instruction block; the ACP agent uses its native behavior. |
| Archiving | ACP has no delete verb, so `cursor-archive.ts` keeps a local set of session ids the drawer stops listing. Cursor's own store is untouched. |
| Plan usage | Not reported. `cursor-agent about` names the tier only, so the hover card shows the plan with an explicit "unavailable" rather than an invented number. |
| Context capacity | A model id's `context` parameter is parsed into tokens and shown in the model selector (for example, `context=1m` becomes `1M`). |
| Context usage | Not reported by ACP, so the pane shows no live context gauge. |

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
| `cursor-mcp.ts` | The server list passed when a session opens (`session/new` and `session/load`), on the shared `McpHttpBridge`. |
| `cursor-archive.ts` | The locally archived session ids. |
| `cursor-ids.ts` | `cursor:` prefix arithmetic, delegating to `src/shared/chat-providers.ts`. |

## Tools over MCP (`cursor-mcp.ts`)

`session/new` takes an `mcpServers` list and the agent advertises `mcpCapabilities.http`, so the
registry is served per session — no global config file to mutate and clean up, and no profile-key
hashing, unlike the `agy` arrangement in `docs/antigravity.md`. The listener, the per-namespace MCP
servers, the registry dispatch, and the call ledger are the shared `McpHttpBridge`; this lane adds
only the `session/new` server list.

Verified live on 2026-09-03, and each point cost a real bug or would have:

- **A session learns about the tools exactly once, when it opens.** Verified 2026-09-21: both
  `session/new` and `session/load` connect the servers they are given (each produces an MCP
  `initialize` plus `notifications/initialized` against the endpoint), and the agent never asks
  again. So the endpoints are resolved through `bridge.start()` at the moment a session opens
  (`CursorSessionDeps.mcpServers` is async for that reason) rather than from whatever the listener
  happened to have — a pane that warmed or replayed before the listener was up used to be handed
  an empty list and then ran every later turn with no ClosedAI tools at all, while a pane whose
  session opened during a turn had all of them. `CursorSession` also records the endpoint set its
  live session was opened with and reopens the session when that set changes, so a pane repairs
  itself instead of staying toolless for its lifetime.
- A `session/new` id that was never prompted is gone from later processes: `session/load` fails
  with -32602 and `Session "<id>" not found` in `data.message`, which the error text now carries
  (verified 2026-09-29). The pane therefore saves a session id only once the session has loaded or
  taken a turn (`onSessionSaved`). A saved session that cannot be reopened is replaced, and the
  visible transcript goes with the next turn as a handoff with the notice "Cursor no longer had this
  conversation…"; other resume failures keep the saved id. One session opens at a time, and the
  session is warmed before the prompt is assembled.
- An `mcpServers` entry **must** carry `headers` (an array). Omitting it fails `session/new` schema
  validation with "expected array" rather than being treated as absent.
- A served call arrives as `kind: "other"`, announced as `title: "MCP: tool"` with an empty
  `rawInput`, and is only named on the first update: `title: "embedded_browser: page"` with
  `rawInput: {providerIdentifier, toolName, args}`. Both updates carry the same `toolCallId`, so
  the transcript renames one row rather than showing two.
- **The result is not echoed back.** A completed MCP call carries `rawOutput: {success: true}` and
  nothing else, so an MCP row shows the call and its arguments but no output text — unlike the
  Antigravity lane, where the CLI repeats it. A `closedai_ui.capture` is the exception: the bridge
  ledger maps it back to the registry call id, so the app's own full-resolution image becomes a
  screenshot row.
- **Native `GenerateImage` follows the same empty completion shape.** ACP does not replay the path
  or bytes the agent sees, so ClosedAI promotes the row by reading `filename` hints when present
  and otherwise the newest image under `~/.cursor/projects/<cwd-slug>/assets/` written since the
  call started. Without that fallback the chat keeps a completed "Generate image" activity row with
  no inline preview.
- `session/request_permission` fires for MCP calls too, and is auto-allowed like any other.

## Not done yet

- **Modes.** ACP reports `agent`, `plan`, and `ask` and accepts `session/set_mode`. The pane has no
  mode control, so the session stays on the agent default.
- **Slash commands.** `available_commands_update` lists the account's commands and skills; the pane
  has no surface for them, so the update is ignored.
- **`readThread` cost.** Reading another thread loads it on the same process. That is how ACP
  exposes history, but it means a cross-provider read starts a session on the agent's side.
