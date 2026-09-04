# Model latency audit — 2026-09-04

This is a source audit, local serialization benchmark, and limited live tool-initialization check,
not a live comparison of provider response times. It covers Send preparation, provider startup/history, context, tools, tracing,
and rendering. Findings below distinguish executed code paths from unmeasured performance
risks. Current contracts remain in application.md, model-context.md, tools.md, and provider guides.

## Findings fixed in this pass

| Finding | Change | Evidence and limits |
| --- | --- | --- |
| Codex percentage compaction started immediately after a turn, ahead of the user's follow-up. Once started, the app can wait up to 90 seconds for it. | Give percentage pressure the same 15-second idle grace as the token trigger. A new Send cancels a queued attempt. | `src/main/chat-context/context-compaction.ts`; tests cover cancellation, threshold scheduling, retry policy, and stale completion. An already-running compaction still blocks. Native provider compaction is separate. |
| Cursor history replay remembered the loaded session id but discarded its returned setup. The next warm/send path requires both and could load the same session again. | Retain setup from `session/load` together with the loaded id. | `src/main/cursor/cursor-session.ts`; regression test proves replay → continue → warm performs one load, and reading another session still restores the current one correctly. The separate cold-catalog duplicate below remains. |
| Raw trace recording JSON-encoded huge nested image strings before discarding nearly all of them. This runs on the main process's model-I/O event loop. | Clip oversized nested strings before JSON encoding, while leaving the provider payload intact. | `src/main/trace/trace-log.ts`; nested 8 MiB image payload benchmark fell from **20.20 ms median to 0.085 ms median**, 15 iterations per version. Maximum was 39.02 ms before and 6.02 ms after. This measures serialization only. |
| Cursor sends were absent from the outgoing-message classifier, despite the first-text timing guide promising all four providers. | Recognize `cursor.out` / `session/prompt`. | `src/main/trace/response-latency.ts`; tests exercise first-text timing for all four providers. This repairs measurement, not inference speed. |
| Antigravity sent an internal READY turn before every new process's user prompt. | Removed the primer prompt and its queue/state handling. User input goes directly to stdin. | A direct CLI probe and then the actual updated session both called the shared browser tool through MCP without a primer. Session tests cover cold/warm/resumed sends and interruption. |
| Cursor's uncached catalog startup loaded the saved session before collecting its replay, causing a second load. | Restore history first and publish the catalog from the returned setup when continuing the loaded session. | Service regression test verifies one load, preserved user/assistant history, populated models, and handshake image support. |
| Telemetry queued one atomic snapshot write per completed tool. | Coalesce updates behind one writer, including changes received during an active write. | Controlled test verifies 200 counter updates produce two snapshots, and a subsequent clear waits for its zero-count snapshot. |

The serialization benchmark used an object with an image data URL containing 8 MiB of `A`
characters, passed to `serialize()` in the local Node runtime. It is a repeatable synthetic
large-string case, not a representative distribution of all trace events. Object traversal,
large arrays, and many small properties can still cost CPU; the retained-output cap is not a
complete bound on serialization work.

## Largest remaining waits

| Priority | Path | What happens | Next useful change or measurement |
| --- | --- | --- | --- |
| High | Codex compaction policy | The saved app-wide percentage threshold is **60%**, versus the default 80%; token and mid-turn overrides are both zero. Every completed turn above percentage pressure can schedule compaction after the new grace; percentage pressure still bypasses token retry cooldown/growth. | Use the existing compaction interval in first-text trace to determine how often it dominates. The grace prevents immediate follow-ups from losing the race; it does not make compaction faster. Saved thresholds were not changed. |
| High, workload dependent | Model reasoning and accumulated context | Saved app-wide selection is `gpt-5.6-sol`, effort `high`; individual chats also have their own selections. Native session history, system instructions, tool definitions/results, and images contribute input. | Compare the same representative prompt and session conditions across effort/context settings before attributing the delay to one setting. No live provider timings were collected and no selections were changed. |
| Medium | Cold process/session preparation | Peer parking occurs after five idle minutes when unselected and twenty when selected. Native idle guards can close processes after fifteen minutes. A subsequent Send pays startup/resume costs. | Compare cold versus warm preparation time. Retaining processes longer trades memory for latency; changing timers alone does not fix slow startup. See `chat-peers/peer-idle-parking.ts` and `idle-process-guard.ts`. |
| Medium | Antigravity empty-success recovery | A successful tools-only turn without final assistant text can trigger one internal recovery prompt. | Count occurrences and inspect native CLI behavior. It is an additional model round trip, but deleting recovery can leave a completed task without an answer. |
| Medium | Pane operation queue | `chat-peers/peer-manager.ts` serializes wake/send/switch operations per pane. A send can wait behind an outstanding operation, including session/history work. | Use preparation timing to identify the operation holding the queue. Removing serialization blindly would introduce session-switch and send races. |

## Tool and context costs

- **Multi-provider search waits for the slowest selected provider.**
  `src/main/tools/search/router.ts` uses `Promise.allSettled`; balanced selects two providers and
  deep selects three. Individual active provider requests have a 20-second deadline; budget
  queueing can add time before that deadline starts. Observers receive partial results, but the
  final query result waits for settlement. Quick depth already selects one provider. Returning
  partial results earlier would change completeness and should be an explicit tool contract.
- **Search/research has real concurrency limits.** The router's request budget is four global
  requests and two per provider. Concurrent research or batches can queue here. Run deadlines
  and registry timeouts are upper bounds, not mandatory sleeps. A faster timeout alone can
  exchange a slow successful answer for an error and another model retry.
- **Browser readiness can hold a tool.** Default readiness is DOM-ready, with a three-second
  timeout and a fifteen-second maximum in `tools/browser/fields.ts`. Explicit load/idle,
  selector, or text conditions can wait longer than a simple DOM-ready read. Idle means a
  complete document and 200 ms of stable text length, not network idle. Browser tools remain
  available; wait semantics were not weakened.
- **Tool context is still substantial.** Constructing the current namespaces without executing
  tools yielded 22 shared tools and approximately **67,374 JSON characters** of names,
  descriptions, and input schemas. Six definitions are marked deferred. Browser/CDP account
  for about 36,083 of those characters. These are raw shared-definition sizes, not token counts
  or the exact provider wire payload; adapters and supported deferral change what is sent.
  No custom workspace namespace remains. Simplifying browser schemas is a remaining prompt
  budget opportunity, but availability and action contracts must stay intact.
- **Every unnecessary tool/model round trip still costs time.** Native file tools eliminate
  the custom workspace-analysis loop; they do not prevent a model from choosing redundant reads,
  checks, or browser actions. The shared engineering prompt no longer requires that custom path.
  Count actual steps before adding more orchestration to control them.
- **Images and output persist in model history.** Capture already limits screenshots to two per
  turn and bounds model image size; generic tool text is also bounded. Provider-native outputs
  and long conversations can still increase context. A small rendered transcript does not
  mean the model received a small history.
- **Same-resource tools can serialize intentionally.** The registry and batch resource locks
  protect operations that share browser/app state. Independent reads can overlap; dependent
  navigation, input, and capture must keep their order. Increasing batch size does not remove
  provider concurrency limits or make conflicting operations safe to overlap.

## Local CPU, I/O, and display risks

| Path | Assessment |
| --- | --- |
| Trace collection | Raw provider events are recorded even when the trace panel is hidden. The ring is bounded at 4,000 entries / 24 million detail characters. The large-string encoding cost is fixed; normal serialization remains synchronous. An open trace panel adds per-entry IPC/rendering. |
| Aggregate telemetry | Pending updates now coalesce behind one writer in `tools/telemetry.ts`. Writes remain asynchronous and are not awaited by the model tool. Snapshot encoding and disk I/O still have a cost; the redundant per-call write queue is removed. |
| Streaming transport | `renderer/chat-controller.ts` coalesces IPC updates on animation frames. That reduces normal render churn; background-window frame throttling can delay visible updates while the provider keeps running. Main-process first-text timing does not measure paint. |
| Markdown | `components/ui/markdown.tsx` lexes the growing response again when its text changes. Completed blocks are memoized, but long active code blocks/tables can still cause repeated parsing and UI work. This is a display-latency candidate; no renderer profile was captured in this audit. |
| Syntax highlighting | Highlighting is already throttled to 250 ms and bypassed beyond 20,000 characters. Current text has a plain fallback, so that throttle is not an intentional delay in provider token generation. |
| History and sidebar | Transcript updates use indexed positions; renderer history is paged, and peer summaries are cached/throttled. These protections do not reduce provider-side history replay or context. No routine full-history clone on every streaming delta was found in the inspected paths. |
| Startup/account/catalog work | Provider startup and uncached catalog/account reads remain cold-path costs. Existing catalog caches and background account reads avoid some of them. It would be inaccurate to charge every warm Send for every startup RPC. |

## Verification and measurement limits

The initial four-module pass had 35 passing targeted tests, typecheck, generated-map verification,
hygiene, and a production build. The follow-up has 23 targeted tests covering telemetry, Cursor
startup/session behavior, and Antigravity session/stream/compaction behavior.

Live follow-up used `gemini-3.8-flash-low`, a temporary generated ClosedAI profile, and a uniquely
named MCP registration serving the real `embedded_browser.page` schema over a controlled browser
host fixture. The initial direct CLI probe completed in 4.92 seconds. The updated session completed
a cold turn in 7.54 seconds and a resumed-process turn in 4.33 seconds; each made exactly one tool
call and returned that call's newly generated title. Temporary profiles and MCP entries were
removed afterward. These small samples verify first-turn tool availability and conversation
resumption, not a latency distribution, actual page rendering, or every model/CLI combination.

The Turn trace measures from pane-manager Send to the first nonempty assistant text received
in main, including commentary. It splits preparation, Codex compaction wait within preparation,
and time after provider dispatch. The last interval mixes provider queueing, prefill, reasoning,
tools, and internal compaction; it cannot identify those separately. It also does not establish
time to a useful answer, completion, or renderer paint. No live provider speedup is claimed.

The next runtime comparison should use one ordinary native-file task and one browser task,
holding model/effort constant, with both warm and cold sessions. Record first text, completion,
tool count, and correctness. First-text improvements alone can hide a model that speaks sooner
but takes just as long to finish.
