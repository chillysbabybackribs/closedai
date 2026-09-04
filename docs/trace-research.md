# Per-turn trace: research record (2026-09-02)

Goal: record every step a model takes inside closedai — prompts sent, model output, every tool
call with arguments and result, token usage, timing — across all three providers
(Codex app-server 0.152.1, Claude Agent SDK 0.3.258 / CLI 2.1.258, Antigravity `agy` 1.1.24).

This file preserves the investigation and proposals from 2026-09-02. Its baseline inventory,
line numbers, and external-version observations are historical, not a description of the current
checkout or instructions to implement every proposal.

## Current implementation note (source review 2026-09-03)

Tracing now exists in `src/main/trace/` and `src/renderer/trace/`: provider traffic, registry
calls/results, turn timing, and normalized chat events feed an in-memory ring. The project rail's
Turn trace opens the view. Limits are 4,000 entries, 24,000,000 total detail characters, and
48,000 characters per detail before its truncation marker. Raw traffic is collected even when
hidden by the view's filters. Restart clears the trace; there is no persistent trace database,
OTel exporter, or opt-in persistent tracing implementation implied by the proposals below.

Tool telemetry remains aggregate-only on disk. Native provider stores and Antigravity's app-side
transcript copies are separate persistence paths. Transcript activity now records timing and
bounded output; background tasks have dedicated normalized items. The trace's performance view
derives model-pass and cache statistics from available raw provider messages, rather than adding
a durable usage ledger. Current references: [Tools](tools.md#turn-trace),
[Application](application.md), and [Model context](model-context.md).

## 1. Baseline before tracing was implemented (2026-09-02)

At the time of this baseline inspection there was no tracing, span, logger, or timing
infrastructure. The current implementation note above supersedes that observation.

| Thing | Where | Notes |
| --- | --- | --- |
| `ToolTelemetry` | `src/main/tools/telemetry.ts:15` | Aggregate counters only; `ToolCallEvent = { toolId, action, ok }` (`src/shared/tools.ts:55`). A former per-call JSONL log is actively deleted on open (`telemetry.ts:31-44`). |
| Privacy stance | `docs/tools.md:192-206` | "without retaining arguments, results, error messages, timing, or conversation identifiers". A trace reverses this and must be an explicit, off-by-default setting. |
| Console logging | 31 `console.warn/log` sites in `src/main` | Subsystem prefixes only, no sink. Provider raw traffic is never logged. |
| `ScreenshotStore` | `src/main/tools/capture/screenshot-store.ts:22` | Bounded LRU keyed by `callId`; the only per-call artifact precedent. |
| `node:sqlite` | `src/main/antigravity/antigravity-history.ts:4` | `DatabaseSync` is already imported, so a trace DB needs no new dependency. |
| `writeAtomic` | `src/main/atomic-write.ts:4` | Full rewrite per call; unsuitable for a hot append path. |

### Event flow (all providers converge)

```
Codex   app-server-client.ts:157 receiveLine → chat-notification-router.ts:21 → chat-normalizers.ts:64 ─┐
Claude  claude-runtime.ts:103 for-await(query) → claude-session.ts:129 → claude-stream.ts:68 ──────────┤
Agy     antigravity-process.ts:114 NDJSON → antigravity-session.ts:115 → antigravity-stream.ts:49 ─────┤
                                                                                                        ▼
                     ChatTranscript.upsert / appendDelta  (src/main/chat-transcript.ts:75, :81)
                                                                                                        ▼
        ChatHub.onProviderEvent (chat-hub.ts:149; line 165 drops non-active providers) → peer manager
                                                                                                        ▼
        index.ts:178 'chat:event' → preload chat.onEvent → chat-controller.ts:44 → chat-state.ts:34
                                                           (drops events for non-selected panes)
```

Tool calls take a separate path that all providers share:
`ToolRegistry.call(request, context)` at `src/main/tools/registry.ts:117`. `context` is already a
trace-context struct: `paneId, threadId, turnId, callId, parentCallId, batchId, source`
(`src/main/tools/tool.ts:19`). Provider entry points into it: `tools/app-server-tools.ts:62`
(Codex `item/tool/call`), `claude/claude-tools.ts:37` (in-process MCP; `toolUseIdOf(extra)` at
`:58`), `antigravity/antigravity-mcp.ts:200` (HTTP MCP; conversation id in `_meta`).

### Choke points for instrumentation

| Signal | Location |
| --- | --- |
| Turn open (prompt + context) | the three `send()` methods: `chat-service.ts:135`, `claude/claude-service.ts:86`, `antigravity/antigravity-service.ts:78` |
| System prompt / tool specs | `chat-context/thread-params.ts:16`, `claude/claude-options.ts:40`, `antigravity/antigravity-instructions.ts:21`; per-turn browser context `chat-context/turn-context.ts:30` |
| Raw provider traffic | `app-server-client.ts:151/:157`, `claude/claude-runtime.ts:103`, `antigravity/antigravity-process.ts:58/:114` |
| Normalized model output | `chat-transcript.ts:75` `upsert`, `:81` `appendDelta` |
| Turn close | `chat-service.ts:415`, `claude/claude-service.ts:303/:341`, `antigravity/antigravity-service.ts:292` |
| Registry tool call + result | `tools/registry.ts:117` (wrap `run` with `performance.now()`) |
| Token usage | Codex `chat-notification-router.ts:67`; Claude `claude-stream.ts:124` and `:295`; Agy `antigravity-stream.ts:144` (`result.usage` currently ignored) |

### Gaps that shape the design

1. Reasoning reaches the renderer but `transcript-rows.ts:23-31` drops it; a trace view can show it with no main-process change.
2. Non-active provider and non-selected pane events never reach the renderer. Collect in main, not in the renderer.
3. No timestamps or durations exist anywhere.
4. Usage is lossy: only `{ usedTokens, contextWindow }` survives (`src/shared/chat.ts:116`). Output, cache read and cache write counts are computed then dropped.
5. Call and result share one transcript item id; args are overwritten on upsert. Record call and result as two trace events at the registry, not from the transcript.
6. Args are truncated for display at 4000 chars (`chat-normalizers.ts:227`) and results for the model at 24 000 chars (`registry.ts:28`). Full fidelity only exists at the registry boundary.
7. Provider-native tools (Codex shell/apply_patch, Claude Bash/Read/Edit/Agent) bypass the registry. They are only visible as normalized items or in the provider's own session log.
8. `chat-service.ts` is at 447 of the 450-line cap. Instrumentation goes in a new `src/main/trace/` module wired by callbacks.

## 2. What each provider already records (verified locally)

### Codex 0.152.1
- Every thread is persisted as a rollout JSONL under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
  (65 files carry `"originator":"closedai"`). Each line is `{timestamp, ordinal, type, payload}` with
  `session_meta`, `turn_context` (turn_id, cwd, approval/sandbox policy), `response_item`
  (`message` with full developer/user/assistant text, `function_call` with name/namespace/arguments,
  `function_call_output` with `call_id` and full output, `reasoning`), and `event_msg`
  (`task_started` with `model_context_window`, `token_count`, `item_completed`, `task_complete`).
  This is already a complete per-turn trace with wall-clock timestamps; the app only needs the file path.
- OTel: `[otel]` in `~/.codex/config.toml` with `exporter`, `trace_exporter`, `metrics_exporter`
  (`none | statsig | otlp-http{endpoint,protocol:binary|json,headers,tls} | otlp-grpc`),
  `log_user_prompt` (bool, prompt is `[REDACTED]` otherwise), `tool_result.max_bytes` (default 2048,
  independent of model-visible output), `span_attributes`, `tracestate`, `environment`.
- Log events: `codex.conversation_starts`, `codex.api_request` (duration_ms, status, attempt, auth.*),
  `codex.sse_event` (`response.completed` carries input/output/cached/cache_write/reasoning token counts
  and `ttft_ms`), `codex.user_prompt`, `codex.tool_decision` (tool_name, call_id, decision, source),
  `codex.tool_result` (call_id, duration_ms, success, arguments, truncated output, mcp_server),
  `codex.turn_cost`, `codex.turn_ttft`, `codex.sandbox_outcome`, websocket events.
- Inbound W3C context is read from `TRACEPARENT` / `TRACESTATE` env vars (`codex-rs/otel/src/trace_context.rs`).
- Known gap (issue #12913, Feb 2026): `codex mcp-server` emits no OTel at all; app-server exports logs and traces (service.name `codex-app-server`) but treat metrics as unverified.

### Claude Agent SDK 0.3.258 (bundled CLI 2.1.258)
- Every session is persisted under `~/.claude/projects/<cwd-slug>/<session>.jsonl`. Each
  `assistant` line carries `requestId`, `timestamp`, `effort`, `message.usage` with input, output,
  cache_creation, cache_read, thinking tokens and `service_tier`; content blocks include `thinking`,
  `tool_use` (id, name, full input) and `tool_result`. The app already reads this store for history.
- Hooks available in-process: `HOOK_EVENTS` in `sdk.d.ts:854` includes `PreToolUse`, `PostToolUse`,
  `PostToolUseFailure`, `PostToolBatch`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`,
  `PreCompact`, `PostCompact`, `PermissionRequest`. Hook payloads carry `tool_use_id`.
- Native OTel: set `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`,
  `OTEL_TRACES_EXPORTER=otlp`, `OTEL_LOGS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`,
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`. Never `console` (it shares stdout with the SDK
  message channel). Content opt-ins: `OTEL_LOG_USER_PROMPTS=1`, `OTEL_LOG_ASSISTANT_RESPONSES=1`,
  `OTEL_LOG_TOOL_DETAILS=1`, `OTEL_LOG_TOOL_CONTENT=1` (60 KB span events),
  `OTEL_LOG_RAW_API_BODIES=1|file:<dir>` (full Messages API request/response JSON, thinking redacted).
  `CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH` sets the cap. `CLAUDE_CODE_OTEL_DIAG_STDERR=1` surfaces export errors.
- Spans: `claude_code.interaction` → `claude_code.llm_request` (model, ttft_ms, tokens, stop_reason,
  `gen_ai.request.model`, `gen_ai.response.id`), `claude_code.tool` (tool_use_id = `gen_ai.tool.call.id`)
  → `.blocked_on_user`, `.execution`; subagent spans nest under the parent `claude_code.tool`.
- Events: `claude_code.user_prompt`, `assistant_response`, `tool_result` (tool_use_id, duration_ms,
  success, tool_input when details on), `api_request` (cost, tokens, request_id), `api_error`,
  `tool_decision`, `api_request_body` / `api_response_body`. All events carry `prompt.id` and `session.id`.
- Trace context: the SDK injects `TRACEPARENT`/`TRACESTATE` into the child process when a span is active
  in the host, and skips injection if `options.env` already sets `TRACEPARENT`.
- Known gap (anthropic/claude-code#53954, Apr 2026, closed not planned): under `query()` streaming input
  only `claude_code.llm_request` spans were emitted; `interaction`/`tool` spans were missing. Unverified
  on 2.1.258. Do not depend on native tool spans from the SDK path; build tool spans from hooks or
  from the registry.

### Antigravity `agy` 1.1.24
- No OTel, no persisted conversation log for headless runs (`conversation_summaries.db` is not updated).
  The stdout stream is the only source: `init`, `step_update` (`step_type` user_input | agent_response |
  tool | checkpoint, state, `text_delta`, `tool_info{name,parameters,output,error}`, per-step `usage`),
  `result` (status, response, summed `usage`). Native tools are visible only through `step_update`.

## 3. Standards as of 2026

- OpenTelemetry GenAI semantic conventions moved to `open-telemetry/semantic-conventions-genai`
  (created 2026-05-05, core split at v1.42.0 on 2026-06-12). Every `gen_ai.*` item is still
  `Development`; nothing is Stable. Pin to a commit and keep the attribute strings behind one
  mapping module.
- Span shape for one agent turn: `invoke_agent {name}` root → `chat {model}` children (CLIENT) →
  `execute_tool {tool}` children (INTERNAL). Required: `gen_ai.operation.name`, `gen_ai.provider.name`.
  Link a chat span's tool_call part to its `execute_tool` span via `gen_ai.tool.call.id`.
- Key attributes: `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.id`,
  `gen_ai.response.finish_reasons`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
  `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`,
  `gen_ai.usage.reasoning.output_tokens`, `gen_ai.response.time_to_first_chunk`,
  `gen_ai.conversation.id` (must be a real provider id, never synthesized), `gen_ai.tool.name`,
  `gen_ai.tool.call.id`, `gen_ai.tool.type` (function | extension | datastore), `error.type`.
- Content is opt-in by design: `gen_ai.input.messages`, `gen_ai.output.messages`,
  `gen_ai.system_instructions`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`. Messages use
  `[{ role, parts: [{type:'text'}|{type:'tool_call',tool_call:{id,name,arguments}}|{type:'tool_call_response',tool_call_response:{id,content}}] }]`.
  Reference implementations gate it with `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=no_content|span_only|event_only|span_and_event`;
  large content goes on the `gen_ai.client.inference.operation.details` log event or an external store with a reference on the span.
- Deprecated names to avoid: `gen_ai.system` (use `gen_ai.provider.name`), `gen_ai.prompt`, `gen_ai.completion`, `gen_ai.usage.prompt_tokens`.
- Industry practice (Langfuse, Phoenix, Braintrust, Laminar, Honeycomb, 2026): one trace per turn, spans
  per model call and per tool call, inputs/outputs attached, cost from usage, and hooks
  (PreToolUse/PostToolUse) used to synthesize tool spans when the runtime's own spans are incomplete.

## 4. What was built (2026-09-02)

The minimal version: an in-memory turn trace with a viewer, no persistence, no OTel, no schema
mapping. See `docs/tools.md` "Turn trace". Files: `src/shared/trace.ts`, `src/main/trace/`
(`trace-log.ts`, `taps.ts`, `summaries.ts`, `ipc.ts`), `src/renderer/trace/`. Taps: a fourth
`AppServerClient` argument, `traceScope` on the Claude and Antigravity session deps,
`ToolRegistry.observe`, and the chat event stream in `src/main/index.ts`. Everything below this
line is the larger design if the trace ever needs to persist or export.

## 5. Design if it grows

1. **Own the trace in main.** A `src/main/trace/` module with a `TraceRecorder` that receives events from
   the choke points above. Do not depend on any provider's OTel exporter for the app's own view; use
   them as optional external export later.
2. **Event model** (in `src/shared/trace.ts`, dependency-free): `TraceTurn { traceId, provider,
   paneId, threadId, turnId, conversationId, model, startedAt, endedAt, status }` and `TraceSpan
   { spanId, parentSpanId, kind: 'invoke_agent'|'chat'|'execute_tool'|'hook'|'provider_event',
   name, startedAt, endedAt, attributes, events[] }`. Attribute keys use the `gen_ai.*` names from
   section 3 through one mapping helper so a future OTLP exporter is a serializer, not a rewrite.
3. **Sources per provider.**
   - Registry: wrap `ToolRegistry.call` for `execute_tool` spans with full args and pre-truncation result.
   - Codex: `turn/start` request → root span; router notifications → chat spans and native tool items;
     `thread/tokenUsage/updated` → usage; keep the rollout path for a "full raw" view.
   - Claude: `send()` → root; `SDKAssistantMessage.message.usage` and `requestId` → chat spans;
     hooks `PreToolUse`/`PostToolUse`/`PostToolUseFailure` → native tool spans keyed by `tool_use_id`;
     `SDKResultMessage.modelUsage` → cost.
   - Antigravity: `step_update` per step → spans; `tool_info` → native tool spans; per-step `usage`.
4. **Storage.** `<userData>/traces.db` via `node:sqlite` (`turns`, `spans`, `span_events` tables,
   content columns nullable) or one JSONL per turn under `<userData>/traces/`. Append-only; never `writeAtomic`.
   Bounded retention (turn count and bytes) like `ScreenshotStore`.
5. **Privacy gate.** New app setting `trace.capture: 'off' | 'structure' | 'content'`, default `off`.
   `structure` records names, ids, timing, usage; `content` adds prompts, messages, args, results.
   Update `docs/tools.md` privacy text when this ships; the change needs owner sign-off per AGENTS.md.
6. **IPC + UI.** Fifth namespace `trace` (`listTurns`, `readTurn`, `onSpan`) copied from the `tools`
   pattern (`src/main/tools/ipc.ts`, preload block, `src/shared/api.ts`). Viewer builds on
   the activity step list in `src/renderer/activity-step-list.tsx` (the generic `ToolPart` card it
   once pointed at was retired on 2026-09-03 in favour of that per-step model),
   a waterfall component, and the tools modal as host. (The vendored
   `src/components/ai-elements/chain-of-thought.tsx` this once named as the waterfall was deleted on
   2026-09-03 as unreachable from every entry point; the waterfall would be built fresh.)
7. **Optional export.** Later: an OTLP/HTTP serializer to a local collector, plus pass-through of the
   Claude and Codex native env/config so a backend like Langfuse or Phoenix sees provider-internal spans.

## Sources
- code.claude.com/docs/en/agent-sdk/observability and /docs/en/monitoring-usage (fetched 2026-09-02)
- github.com/anthropics/claude-code/issues/53954
- github.com/openai/codex: codex-rs/otel/src/{tool_result.rs, events/session_telemetry.rs, trace_context.rs}, codex-rs/core/config.schema.json; issue #12913
- open-telemetry/semantic-conventions-genai via hidekazu-konishi.com verbatim guide (commit c739977, 2026-07-30); john-hodge.com state-of-conventions (2026-07-17); veraexmachina.com (2026-06-29)
- Local: `~/.codex/sessions/2026/09/02/rollout-*.jsonl`, `~/.claude/projects/-home-dp-Desktop-closedai/*.jsonl`, `node_modules/@anthropic-ai/claude-agent-sdk/{manifest.json,sdk.d.ts}`
