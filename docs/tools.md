# Tools

Everything the app offers a model lives under `src/main/tools/`. Tools are provider-agnostic:
the registry is the single source of truth, and a provider adapter translates it to that provider's
protocol: `app-server-tools.ts` for Codex (`dynamicTools` + `item/tool/call`),
`src/main/claude/claude-tools.ts` for Claude Code (in-process MCP), and
`src/main/antigravity/antigravity-mcp.ts` for Antigravity (HTTP MCP). The same page tool appears as
`embedded_browser.page`, `mcp__embedded_browser__page`, and `mcp_embedded_browser_page`, respectively.
Source review: 2026-09-04. See [Model context](model-context.md) for instruction assembly.

## Three levels, three rules

Decide where a capability goes before writing it. Pick the lowest level that fits.

| Level | What it is | Add a new one only when |
|---|---|---|
| **Namespace** | A domain, e.g. `search`, `browser`. One directory. | The domain differs. |
| **Verb tool** | One tool to the model. A plain tool has one operation; an action tool groups operations that share a result shape and trust level. | The result shape or risk level differs (keep read-only and mutating capabilities apart). |
| **Action** | One verb inside an action tool, e.g. `navigate`, `read_page`. Usually one file. | The default extension point when an existing action tool fits. |

Namespace names the app-server reserves for OpenAI's own tools are rejected at `thread/start`
(`browser` is one; the error names the collision). Prefix with what makes ours distinct,
e.g. `embedded_browser`.

Limits enforced at startup: snake_case names, unique names, non-empty descriptions,
`type: object` schemas, at most 8 actions per tool, and a field that appears in two actions
must have the same schema in both.

## Layout

```
src/main/tools/
  tool.ts              contract + argument helpers
  action-tool.ts       defineActionTool: many action files -> one tool
  registry.ts          validation, timeouts, error handling
  app-server-tools.ts  Codex adapter (dynamicTools + item/tool/call)
  manifest.ts          renderer-facing registry snapshot for the Tools modal
  telemetry.ts         aggregate run/error counters + compact JSON persistence
  index.ts             public exports and createToolRegistry factory
  <namespace>/
    index.ts           namespace and its tool definitions
    <action>.ts        optional ToolAction modules for an action tool
    <support>.ts       provider clients, routing, hosts, and other focused helpers
```

Small namespaces may define a plain tool or assemble an action tool directly in their
`index.ts`. Split a concern into a tool subdirectory only when its implementation needs the
extra boundary; do not create a second registry or provider-specific execution path.
`src/main/index.ts` composes the namespace factories into the application registry.

## Current namespaces

These are registered in `src/main/index.ts`, after the browser/capture accessors are created and
before the app-server starts.

| Namespace | Tool | Actions | Purpose |
|---|---|---|---|
| `credential_vault` | `list`, `read` | — | Gives every provider access to credentials saved in the app. `list` returns labels, ids, types, and masked field metadata without decrypting secrets. `read` requires one credential id, exact field ids, and an audit reason; it returns only those values, rejects `tool_batch` aggregation, and marks its result sensitive so the Turn Trace records a redacted placeholder. Shared model instructions allow reads only for the current user-requested operation and prohibit echoing, logging, or persisting retrieved secrets. |
| `embedded_browser` | `page` | `navigate`, `read_page`, `wait_for`, `fetch`, `extract`, `query`, `evaluate`, `console` | Browser-page inspection for the pane the user can see. It can open a URL or search query in an explicit `tab_id` (or the active tab by default), wait for page readiness, and read visible text from the whole page or one selector. `tab_id` and `new_tab` are mutually exclusive. `fetch` issues a request from inside the tab, so it inherits that tab's origin, cookies, and signed-in session — the way to reach a same-origin API the page itself calls, including POST endpoints. `extract` projects a JSON document (`path` to a subtree, `fields` per item, `limit` rows) so a large response costs only the part that was asked for. `query` returns structured facts (tag, id, classes, role, name, text, value, href, src, disabled, checked, visibility, bounds, named attributes) for every element matching a selector, with `text_contains` and `visible_only` filters. `evaluate` runs JavaScript in the main frame through the WebContents the app owns (an expression, or statements with `return`; promises awaited) and returns a bounded JSON value with DOM nodes summarised and cycles cut. `console` lists the tab's captured console messages and page errors with navigation markers, `min_level`, `since_navigation`, and cursor paging. None of the three attach a debugger. |
| `embedded_browser` | `network` | `requests`, `wait`, `body`, `rules`, `add_rule`, `remove_rule`, `clear` | The session's always-on request record, captured in the main process from Electron's `webRequest` hooks (`src/main/browser-network/`): every request from every tab and from the session itself, with method, resource type, status, request and response headers, timing, redirects, post data, cache flag, and error, kept across navigations in a 2,000-record ring with cursors. `requests` filters by tab, URL substring, type, method, status, state, and `after_cursor`; `wait` resolves when a matching request finishes after a cursor taken before acting, so the request an action triggers is the one returned. `body` reads a response: from the tab's debugger buffer when CDP Network capture held it, otherwise by replaying the recorded request on the session with its headers and post data (`source` says which; a replay note warns that a non-idempotent endpoint ran twice). Rules act at the session's blocking stages without pausing the page: `block`, `redirect`, `request_headers`, and `response_headers` (null removes), scoped globally or to one tab, with hit counts. |
| `embedded_browser` | `session` | `fetch`, `cookies`, `set_cookie`, `remove_cookie` | The user's signed-in session used directly by the main process. `fetch` sends through Chromium's network stack on the browser partition with the session's cookies and no CORS policy, so cross-origin APIs that reject a page's fetch answer here; it returns status, response headers, redirect facts, and the body (JSON parsed when it fits `max_chars`, text otherwise, binary as base64 with byte length). A large JSON response is projected rather than truncated: `json_path`, `fields`, and `limit` run before serialisation, the same projection `page.extract` uses. Cookie actions read and write the cookie store for any domain or URL, no page required. |
| `closedai_ui` | `capture` | `app_window`, `browser_page`, `crop` | Visual evidence. The first two actions capture the composed app or one readiness-gated page; `crop` enlarges a retained region. The model receives a scaled JPEG (max 960×720); the retained display image (up to 1920×1440) goes to `ScreenshotStore`. |
| `closedai_app` | `state` | plain tool | Compact app facts from the main process (workspace panes, a chat pane, browser tabs, downloads, window) plus renderer-only ui facts (open dialogs and menus, drawer, history panel, composer state, focused control). No DOM walk; sections are selectable. |
| `closedai_app` | `command` | `new_chat`, `send_message`, `stop_agent`, `open_chat`, `close_chat`, `select_model`, `browser_tab` | Deterministic commands over the same services the renderer's IPC calls. `browser_tab` covers tab-strip actions including targeted reload, duplicate, rename, and bulk close. `send_message` can await the target pane's turn; commands aimed at the calling pane are refused. |
| `closedai_app` | `ui` | `controls`, `click`, `type`, `press_key`, `scroll`, `wait_for` | Renderer inspection plus exceptional real interaction by stable control id (`data-ui`, manifest in `src/shared/ui-controls.ts`). Click, type, and key actions require `fallback_reason`; deterministic `state`/`command` operations come first. |
| `browser_cdp` | `page` | `inspect_page`, `click`, `click_at`, `type`, `press_key`, `scroll`, `dismiss_overlay` | Semantic page inspection plus exceptional real CDP input, deferred where supported. Input actions require `fallback_reason`; `fetch`/`extract`, site APIs, and non-input protocol operations come first. |
| `browser_cdp` | `protocol` | `capabilities`, `targets`, `command`, `target`, `events`, `requests`, `body` | Advanced CDP fallback, deferred where supported. Start with `embedded_browser` for pages, recorded requests, and signed-in APIs. CDP `requests` and `body` remain available for captured protocol traffic. Raw `Input.*` commands require `fallback_reason`; screenshots remain ordinary commands. Target inventory exposes flattened child sessions; `target` wraps attach/detach/create/activate/close. See [CDP](cdp-tool-foundation.md). |
| `browser_cdp` | `profile` | `start`, `stop`, `metrics` | Cost measurement folded in the main process. `start` arms JS byte coverage, CSS rule coverage, and heap allocation sampling by default; `cpu` must be asked for explicitly and is refused alongside `script`, because precise coverage and the sampling profiler are both Profiler-domain recordings over one V8 isolate and arming both was measured here to fail the next navigation to a heavy page with `ERR_FAILED` and to crash the renderer on a retry. Every channel's stop is bounded and reports under `unavailable` rather than stalling. `stop` returns per-URL used/unused bytes, per-function self time, and per-site retained bytes, ranked worst-first. The raw protocol payloads cannot cross the tool boundary — one `Profiler.takePreciseCoverage` on an article page measured 949,330 characters — so the arithmetic happens in `src/main/cdp/cdp-profile.ts` and only the answer is returned. CSS rule usage arrives as a delta of *used* rules, so unused bytes are measured against the stylesheets' own text, and heap sampling is re-armed on each main-frame commit because V8 restores the profiler and coverage agents into a new document but not the sampler. `metrics` is a cheap snapshot with nothing armed. |
| `browser_cdp` | `instrument` | `hook`, `recording`, `unhook` | Pre-document API recording. The recorder is installed with `Page.addScriptToEvaluateOnNewDocument`, so it wraps `fetch`, XHR, WebSocket, `document.cookie`, `localStorage`, `eval`/`Function`, the fingerprinting getters (navigator, screen, canvas, WebGL, timezone) and errors before any of the site's own script runs, and it survives navigations and redirects. Patches observe and always call through. Counting happens in the page under a ring buffer; `recording` returns exact per-channel counts, the most frequent distinct calls, and the newest ones with their offset from document start. |
| `browser_cdp` | `emulate` | `apply`, `reset` | Device and environment emulation that actually lands. `Emulation.setDeviceMetricsOverride` alone applies screen metrics, `devicePixelRatio` and touch points but leaves the layout viewport following the headful widget, so a responsive site keeps serving its desktop breakpoint; `apply` therefore also shrinks the tab's native surface to the emulated viewport (`BrowserTab.setEmulatedViewport`), the way DevTools device mode resizes the inspected view. Presets plus user agent, colour scheme, reduced motion, timezone, locale, geolocation, network throttling and CPU slowdown. Every result carries the page's own measurement, so an override that did not land is visible rather than assumed. |
| `search` | `query` | plain tool | Routed public-web search across Brave, Serper, Tavily, and You.com, with normalized, deduplicated results and bounded in-memory caching. Defaults to `depth: quick` (one provider) and `presentation: live` (reuse one tab per pane/thread/turn); `live: true` bypasses the ten-minute cache and refreshes it with current provider results. |
| `search` | `run` | `start`, `extend`, `cancel` | Incremental public-web research: independent queries and static source readers overlap inside one app-owned run. Live presentation is the default; a retained browser tab opens on an actual source as URLs arrive. `extend` accepts only an active run and directs completed-run follow-ups to a new run. |
| `search` | `read` | `results`, `wait`, `source` | Cursor-based source updates, bounded event waits, and retained document excerpts. Observes the calling pane/thread's runs without starting more requests. Oversized wait and excerpt budgets are capped at 20 seconds and 12,000 characters rather than rejected. |
| `peer_chats` | `list`, `read` | plain tools | Read-only status and paginated transcript access to other panes and visible subagent summaries. `read` takes an id from `list` and pages the newest 30 items backwards by default (at most 100), inside a serialized budget (`max_chars`, 6k default, 16k ceiling) that clips long tool detail, output, diffs and screenshot data URLs and reports `totalItems`; `order: "oldest"` follows a chat forward and `types` narrows to the item kinds wanted. It does not start or control agents. Reasoning items are excluded from both previews and pages, matching `recall` and thread handoff, so one model's thinking never enters another model's context. |
| `peer_chats` | `recall` | plain tool, read-only | Bounded phrase search or exact-message excerpts from the caller's current chat or frozen direct continuation source, plus saved checkpoint state. |
| `peer_chats` | `checkpoint` | plain tool, writes notes | Revision-checked replacement of the caller's structured working notes; cannot control sessions or write other panes. |
| `tool_batch` | `run` | plain tool | Runs up to 16 other tools by default, sequentially or in parallel by resource. Same-target work serializes; distinct explicit browser targets can run concurrently. When the outer batch ends or times out, its signal cancels in-flight inner calls, releases their resource locks, and prevents queued calls in that target lane from starting. `toolBatchMaxCalls` configures 1–64 at startup; nested batches are refused. A failed sequential batch compensates itself: browser state armed by earlier steps that nothing on screen reveals — profiling recorders, a pre-document hook, device emulation — is released in reverse order and reported, including after a batch timeout, because the plan that justified arming it no longer holds. State a completed step deliberately released is not released twice, visible or consequential mutations (an opened tab, a cookie, a network rule) are never undone, and parallel calls are declared independent so a failure does not unwind them. See `src/main/tools/batch/compensation.ts`. |

The model-facing names intentionally differ from OpenAI reserved namespaces. For example,
ClosedAI uses `embedded_browser`, not `browser`.

`tool_batch` reads `toolBatchMaxCalls` from `<userData>/app-settings.json` when ClosedAI starts.
The default is 16; configured values are rounded and clamped to 1–64. Restart the app after
editing the setting so the model-facing description and runtime enforcement use the new limit.

File search, reading, and editing use native provider tools. ClosedAI's workspace inspection
namespace has been removed, along with source hashing, related-source bundles, automatic source
observations, and the injected repository map. Browser and web-search namespaces remain available.

The renderer can show several chats at once. `closedai_app.state` UI facts include
`layout.visiblePaneIds` and `layout.browserVisible`; composer facts describe the focused tile.
`closedai_app.ui` chat/composer control ids resolve within that tile. Focus a different tile with
`layout.pane-drag` and its chat id before interacting, or use deterministic pane-id commands.
The `layout` control family exposes conversation-tab, split, hide, browser-toggle, and resize controls.
`layout.new-chat` adds a tab in the target tile, `layout.tab` selects one, and `layout.tab-close`
removes it from the tile without stopping its turn or deleting history; items are chat ids. Split actions
and the browser toggle live in each chat's title header; their item is the chat id.
With multiple visible tiles, `layout.new-chat` starts a fresh chat in the tile named by its item
without changing the other tiles or the split geometry.
The sidebar context menu's `drawer.row-split-right` and `drawer.row-split-below` open or move the
row's existing chat alongside the focused pane; their item is the chat id.
Hiding a tile keeps its turn running; `close_chat` still detaches and stops it. A hidden browser
keeps its tabs, but semantic page input still requires a visible page.

### Application facts, browser targets, and batching

Use `closedai_app.state` for app facts, `closedai_app.command` for service operations, and
`closedai_app.ui` only for exercising real controls when deterministic service operations cannot
complete the task. Browser-page DOM and CDP targets
belong to the browser tools; app renderer controls belong to `closedai_app.ui`. Workspace state
shows at most 12 panes, prioritizing selection, caller, running panes, and real conversations;
`omittedPanes` reports any remainder. Browser/download lists are also bounded.

`tool_batch.run` defaults to sequential execution with stop-on-error. In parallel mode, calls
with the same resource key keep their input order. Explicit `tab_id` values allow independent
browser targets to run concurrently; active-tab operations and tab-strip mutations form a
browser-wide barrier for the resource-scoped calls in that batch. Unscoped calls stay independent.
Every call name is resolved against the registry before the first one runs: a batch naming a tool
the app does not own — typically one of the model's own harness tools, which are not routable here —
fails as a unit, names the tools a batch can run, and executes nothing.
Each nested call retains validation, switches, timing, and telemetry. Set `include_result: false`
for successful intermediate payloads; failures are always included. Any failed or skipped call
makes the batch result an error, while successful results stay available. Inspect the per-call
status and retry only the work that needs recovery; never replay successful mutations just because
the batch failed. In Codex exec scripts use direct `await`/`Promise.allSettled` instead of wrapping
another batch tool. Batching ordinary work is optional: group independent reads when useful,
inspect results before dependent decisions, and serialize same-target mutations and foreground input.

Real pointer and keyboard input is an escape hatch, not a normal navigation strategy. Every
`closedai_app.ui` click/type/key action, semantic browser click/type/key/dismiss action, and raw
CDP `Input.*` command requires a non-empty `fallback_reason`, which is preserved in the turn trace.
Group the fallback with the inspection that identified its target and a post-action assertion in
the same sequential batch. A Codex exec script is the batching boundary; direct-call providers use
`tool_batch.run`, and the runtime refuses their unbatched input calls. Coordinate clicks remain the
last fallback after semantic refs. The batch validator also refuses real input in parallel batches
or without a later recognized read/wait/capture action that can verify the result.

`resource-locks.ts` shares those keys with registry locking. Lock conflicts fail with a busy
target message rather than wait indefinitely. Current keys cover app input, navigation, semantic
page input, raw `protocol.command`, browser-page captures, and app tab commands. The newer
`protocol.target` convenience action currently has no resource key. These locks do not coordinate
human input or provider-native tools, and distinct tab locks do not serialize the shared foreground
tab: batch independent reads, but sequence semantic inputs that switch between visible tabs.

### Parallel research runs

`search.run.start` accepts up to six query objects (the same fields as `search.query`) and
twenty known URLs. At least one is required. It returns a run id immediately. Each provider's
completion schedules source reading without waiting for other providers. Follow-ups use
`extend` while the run is active, up to twelve queries total. Provider answers are not retained
as retrieved document evidence. Index overlap is reported as `discoveredBy`, not factual
corroboration. The legacy query's `corroboratedBy` field likewise means URL overlap only.

Brave discovery uses its `/res/v1/llm/context` endpoint rather than human-oriented Web Search.
The adapter returns extracted grounding chunks as normalized snippets and uses source metadata for
page age. Quick, balanced, and deep requests consider 10, 20, and 50 candidates with 2,048,
8,192, and 16,384-token context budgets respectively; the requested result count remains the
maximum number of returned URLs. Relevance thresholds progress from strict to balanced to lenient,
and `live: true` adds Brave's best-effort `Cache-Control: no-cache` request header.

One registry-wide router admits four provider requests, at most two per provider, across both
synchronous queries and research runs. Providers have twenty-second deadlines. A separate source
reader admits eight HTTP reads, at most two per starting origin. Both queues alternate eligible
owners. The source reader currently does not retry or honor Retry-After; failures remain visible.
Redirects stay under the starting-origin slot. These are initial bounds, not measured optimal
settings or a complete per-origin rate policy.

Runs default to twelve documents and a 45-second deadline; callers may select 1–20 documents
and 1–120 seconds. At most eight runs are active, and 32 completed/active runs are retained.
Stop, pane detachment/project switching, turn replacement/completion, and shutdown cancel owned
background work. Finish retrieval before ending the model turn. Completed runs remain readable
in the same pane/thread until eviction or app restart. Run files are an app-owned session cache
under `<userData>/research-runs`, cleared on the next launch; eviction also removes their files.

`search.read.results` returns source states and errors under a 16k-character target budget.
At most twelve recent errors are returned; `omittedErrors` reports earlier errors beyond that bound.
Keep records by source id; later deltas replace earlier states. Continue from the returned cursor,
including when `omittedSources` is nonzero. `wait` returns on a revision change or a bounded wait
(default ten seconds, maximum twenty); aborting that wait does not cancel the run. `source`
returns retained text by id, offset, optional literal query, and character budget (default 6k,
maximum 12k), with hash, retrieval time, MIME, and incomplete status. Completion means all work
settled, not that every provider or source succeeded.

Static sources use an isolated nonpersistent Electron session and omit credentials. Bodies are
streamed to a bounded raw file (512 KiB), HTML is parsed inertly with parse5, and extracted text
is retained up to 120k characters. Truncation is explicit. JSON and text are also supported;
PDFs, empty JS shells, and unsupported MIME are reported for browser follow-up. Parsing does not
execute JavaScript or resolve CSS visibility and is not a rendered-page verification.

Both `search.query` and `search.run.start` default to `presentation: live`. The first live search
in a pane/thread/turn opens the first eligible supplied source URL, or waits for an actual source
URL from the search APIs. It never opens search-engine results pages for discovery. The first
source opens while other providers and background reads continue. Further searches reuse the tab
without navigating away from a source the model or user is reading; a closed tab is recreated.
The visible tab uses the normal browser session. The result reports `presentation.tabId` and
that it opened, not that navigation completed. Models should inspect relevant sources in that
tab while background research continues and capture pages when making visual claims. The engine
does not automatically follow results or close the tab on cancellation. Explicit
`presentation: background` suppresses opening/reusing a tab when the user requests headless work.
For multi-query runs, presentation is a run-level field, not an individual query field.
Before a source arrives, `presentation.state` is `waiting_for_source`; `search.read` returns the
tab id once opened. If discovery finishes without an eligible source, state becomes `no_source`
and no tab opens. Search-engine result URLs returned by providers are skipped for collection and
presentation; explicitly supplying them as run source URLs is rejected. Browser failures are
reported as `presentation.state: failed` while API research continues.
Hidden rendered workers,
live target transfer, dedicated progress UI, and Follow/Take over controls remain later slices.
`live: true` on each query still controls cache freshness only.

Regression coverage includes omitted presentation on both tools, turn-scoped tab reuse, explicit
background, and an isolated Chromium check: `node scripts/search-live-check.mjs`. The latter loads
a real browser page through the production runtime while a local source response remains pending,
using a temporary bundle and profile without rebuilding or restarting the user's app.

The production search pipeline (real API credentials, `SourceStore`, live source tab, `search.read`
excerpts) is verified with `npm run search:pipeline` (`scripts/search-pipeline-live-check.mjs`).
Requires at least one search API key documented below.

### Search credentials

Search providers read credentials from environment variables first and the Linux Secret
Service keyring second. The supported environment variables are `BRAVE_SEARCH_API_KEY`,
`SERPER_API_KEY`, `TAVILY_API_KEY`, and `YOU_API_KEY`. Desktop keyring entries use service
`codeapp-vault` and accounts `brave_paid_search`, `serper_api_key`, `tavily_api_key`, and
`you_api_key`. A query succeeds when at least one selected provider succeeds;
individual provider failures remain visible in the normalized result.

## Writing an action

```ts
import { textResult } from '../../tool.js'
import type { ToolAction } from '../../action-tool.js'

export const search: ToolAction = {
  action: 'search',
  description: 'Search <provider>. Returns up to `limit` hits as "title — url — snippet" lines.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, description: 'Search terms.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 10.' }
    },
    required: ['query'],
    additionalProperties: false
  },
  async run(input) {
    // input is already validated against inputSchema (without `action`).
    return textResult('...')
  }
}
```

Descriptions are for the model: say what it does, when to use it over its siblings, and what
comes back. Return `failureResult(...)` for expected failures so the model can recover; throw
for bugs and the registry reports them. Use `usageResult(...)` when the call itself was wrong —
a name, argument, or rule the model got wrong — and make that message name the valid options
rather than only the mistake, because the failure text is the only correction the model gets.
Those calls are counted as misuse, so a description that keeps failing this way is visible.

## How the model sees it

One tool per verb tool. Its description is the preamble followed by one section per action,
and its schema is flat: an `action` enum plus every action's fields, each annotated with which
actions require or use it. At call time the registry validates against the chosen action's
schema, so errors are precise even though the advertised schema is the union.

Codex integration is in `app-server-tools.ts`. The registry is converted to app-server
`dynamicTools` for `thread/start` and `thread/resume`, and calls arrive as `item/tool/call`.
The adapter maps registry text results to `inputText` and image results to `inputImage`.

Set `deferLoading: true` on rarely used tools. Codex advertises that discovery flag; Claude maps
it to `alwaysLoad: false`. Raw CDP protocol, profiling, instrumentation, and emulation now use it.
Providers without deferred discovery still receive the definitions. Tools remain callable and
visible in the Tools modal, and restricted action sets preserve the discovery flag.

## Results live in the thread history

The app-server replays the whole thread (every tool result, every image) to the model on every
turn, and only compacts by itself near the context limit. Several mechanisms keep that history small:

- The registry shares `MAX_RESULT_TEXT_CHARS` (24k characters, about 6k tokens) across all text
  blocks in one result, including truncation notices. Small blocks are allocated first, so trailing
  errors or ids survive a large dump. Excess block counts receive an explicit omission notice;
  image blocks stay separate under the capture budget. This sits below the 10k-token result budget of Codex's code-mode `exec` tool, so
  the model reads ClosedAI's "narrow the request" advice rather than Codex's silent head/tail
  cut. JSON results shrink structurally (`tools/truncate-json.ts`: shorter strings, fewer array
  items, shallower nesting, plus a `_closedai_truncated` note) so a script's `JSON.parse` never
  throws on a cut string; plain text is cut with a footer. `read_page` takes the page's text
  unsliced and applies that same bound itself, so a tab showing a JSON document shrinks
  structurally instead of being cut mid-document — but `extract` is the cheaper answer for JSON,
  because it projects before serialising rather than truncating afterwards. CDP JSON results are capped tighter
  still at 16k characters (`tools/json-result.ts`, shared by the CDP and app tools) because
  protocol dumps are the chattiest text source.
- Capture actions are capped at `DEFAULT_MAX_CAPTURES_PER_TURN` (2) images per turn across
  `app_window`, `browser_page`, and `crop`; past that the action fails with advice to read page
  state instead, and each image result reports how many are left. A capture scaled below 60% of
  its source width tells the model to crop for detail rather than capture again
  (`capture/budget.ts`, `capture/result.ts`).
- Capture actions return a bounded image to the model (image tokens scale with pixels) and keep
  the larger display capture in `capture/screenshot-store.ts`, keyed by the tool call id. The
  transcript looks the call id up when it renders the screenshot item and falls back to the
  model's copy once the store has evicted it (60 entries or 96 MB, newest kept).
- Historical measurement, 2026-09-02 across ~1,200 model steps: with prompt caching (median 98% of input
  tokens cached) a step after a tool result takes a median 2.7 s under 40k context and 3.4-4.0 s
  at 200k. These are step durations, not Send-to-first-text measurements, and do not establish
  that context size has little effect for other workloads or cold caches. Compaction took
  60–90 s in those observations. Compare first-text timing, cache reuse, and recall before
  adopting a smaller active-context target.
- `ChatService` watches `thread/tokenUsage/updated` and asks for `thread/compact/start` after a
  turn ends with the context above `chatCompactAtPercent` (default 80; 0 disables this trigger).
  The independent `chatCompactAtTokens` trigger defaults to 0 (off), with nonzero values rounded
  and clamped to 20,000–2,000,000. Both triggers schedule native compaction after 15 idle seconds. A new send
  or provider turn cancels a queued attempt; a compaction already in flight still blocks sends.
  Token retries require five minutes plus growth of max(4,000, 25% of the budget) from the lowest
  usage observed since the previous attempt. Window-percentage pressure bypasses those retry
  requirements, but still waits for the idle grace.
  One compaction per completed turn at most. This is a soft trigger: native compaction may retain
  more than the target, and turns can grow past it. See `src/main/chat-context/context-compaction.ts`.
- Opt-in: `chatMidTurnCompactTokens` (default 0) launches the app-server with
  `-c model_auto_compact_token_limit=<n>` so Codex compacts mid-turn past `n` tokens. At 100k it
  fired every ~10 exec calls in a heavy turn, which is why it is off. See
  `src/main/chat-context/app-server-config.ts`.
- Code mode (Codex 0.152, every gpt-5.6 model is `tool_mode: code_mode_only`): the model never
  calls a dynamic tool directly. It writes JavaScript for a generic `exec` tool and reaches
  ClosedAI tools as `tools.<namespace>__<tool>(args)`, declared to it as `Promise<unknown>`.
  Verified against the CLI: a dynamic tool's `[text, image]` result arrives in that script as
  ONE STRING — the text, a newline, then the raw `data:image/jpeg;base64,…` URL. Nothing is an
  image unless the script passes the URL to `image()`. Before the recipe was spelled out, 29 of
  43 captures in one day's threads were dumped through `text(JSON.stringify(r))`: ~10k tokens of
  base64 each and no picture. So every tool description states its return shape for scripts,
  the capture result text repeats the split recipe (`EXEC_IMAGE_HINT` in `capture/result.ts`,
  so it survives compaction), and the developer instructions say it once more.
- Reading habits, not caps, drive context size: a fresh thread reached 100k tokens in 26 calls
  because the model ran `sed -n '1,360p'` over several files per call with
  `max_output_tokens` 22k-30k. The developer instructions ask for ranged reads and JS-side
  slicing before `text()`; Codex itself does not truncate `exec_command` output inside a script.
- Pasted screenshots are bounded to 1600x1200 JPEG before they are sent
  (`src/main/chat-attachment-images.ts`): Codex re-sends user messages verbatim through every
  compaction, so a full-size paste is paid for on every call for the life of the thread.
- Continuation/branch actions create a fresh pane, and a provider switch creates a fresh thread
  in the existing pane: the next message carries a digest of the old thread as
  `additionalContext` (`closedai.chat.handoff`, built from the app transcript without a model
  call, ≤12k chars). An applicable checkpoint and frozen source boundary accompany the handoff
  so bounded source recall remains available. Branching from a response includes conversation
  only through that completed message.
  Tool output, screenshots, and reasoning stay in the old thread. See
  `src/main/chat-context/thread-handoff.ts`. The header shows the context percentage so the
  user can see when to reach for it.

To trial the smaller budget, quit ClosedAI, set `"chatCompactAtTokens": 32000` in
`<userData>/app-settings.json`, and relaunch the updated build. There is not yet a settings UI
for this field. Keep `chatCompactAtPercent` at 80 as the window-pressure fallback. Restore
`chatCompactAtTokens` to 0 to disable only the experiment; existing history is unchanged either
way. 32k is an evaluation starting point, not a measured optimum. Native compaction does not
automatically generate the model-written checkpoints described below. Seamless provider-session
rotation is not implemented.

## Working memory and recall

`peer_chats.checkpoint` writes a small structured checkpoint only for the calling pane's active
thread/turn. It requires `expected_revision` (0 when absent) and `state` with `goal`, `constraints`,
`decisions`, `progress`, `nextSteps`, and `files`. Goal is at most 1,000 characters; each list has
at most 12 non-empty strings of at most 400 characters. The whole serialized state must fit
6,000 characters. Oversized or stale-revision writes fail without replacing the checkpoint.
The response contains revision and boundary metadata rather than echoing the entire state.
One checkpoint per pane is persisted in the existing settings store, not a separate transcript
database. It is model-authored data, not an approval or independently verified work record.

`peer_chats.recall` is read-only and accepts `scope: current|source`, optional literal
case-insensitive `query`, `types` (item kinds to search, so tool traffic cannot crowd out the
messages), `limit` (default 5, max 8), or `item_id` with a character `offset`.
Search results contain at most 800 characters per excerpt and fit within 16,000 serialized
characters including checkpoint state. Use `nextOffset` to read more of a matched item, or
`nextBeforeItemId` as `before_item_id` to search older items. `hasMore` means older candidate
items remain, not necessarily more query matches. Screenshot and reasoning items are excluded;
user/assistant/plan text and textual tool/command/file-change evidence are eligible. File/image
attachment contents are not fetched. Queries are literal phrases, not semantic/vector search.

The current scope reads the caller's existing transcript. Source scope uses only the direct
continuation source and its frozen last-item id; later messages are excluded even when the
original pane keeps running. A source with no recoverable boundary is unavailable rather than
read without limits. Closed source panes use existing provider history readers without opening
that chat in the UI. Those readers can still load a full transcript in main before selection;
this does not yet optimize provider-history disk/RPC transfer. Provider compaction, missing
history, or id changes can make old evidence unavailable. No arbitrary thread id or pane id
argument is accepted. Workspace/thread changes and cancellation invalidate pending reads.

Both memory tools are deferred where supported. Shared instructions suggest a checkpoint at
meaningful milestones, not every turn. Continuation copies applicable notes into the existing
bounded handoff, marked untrusted; later conversation can supersede those notes. There is no
new model call on Send and no automatic same-pane session replacement. Disabling the checkpoint
tool prevents new model writes; existing notes/history are not deleted.

## Seeing what exists: the Tools modal

The Tools button on the composer's project rail opens the Tools modal (`src/renderer/tools/`). It reads
the registry as data (`manifest.ts`): every namespace, tool, and action, the exact description
and schema the model is sent, and which providers the registry is advertised to.

The same modal owns persisted enable/disable switches. A disabled plain tool is not advertised to
providers and calls are refused. A disabled action is removed from the action enum when the action
tool supports restriction; otherwise the call is refused if the model still tries it. Toggle state
is stored in `app-settings.json` and applied before each `ChatService` starts or resumes a thread.

## Telemetry

The registry reports an aggregate-only event after every call (`registry.subscribe`): tool id,
optional action name, and whether it succeeded. `ToolTelemetry` stores only per-tool and
per-action run/error counters in `<userData>/tool-telemetry.json`, so counts survive restarts
without retaining arguments, results, error messages, timing, or conversation identifiers.
Persistence uses one writer: bursts share the next snapshot instead of queuing one atomic
write per call. Updates received during a write trigger a subsequent snapshot, and clearing
counts waits for pending writes to drain.

On the first start after this format was introduced, ClosedAI reads only the counters from the
old `tool-telemetry.jsonl`, writes the aggregate JSON file with mode `0600`, and removes the old
text-bearing log. The Tools modal shows the on/off switch, run count, and error count for each
switchable capability and updates those counters live. "Clear counts" resets every aggregate.
Failures from unknown, disabled, and invalid calls are counted too.

Misuse is counted separately as a subset of failures: calls the app refused before the tool ran —
an unknown name, a switched-off tool, invalid arguments, a wrong action verb, or a documented rule
a tool enforces itself with `usageResult(...)`. The Tools modal shows a misuse count on a card only
once that tool has one. Treat a rising misuse count as a defect in that tool's directions, not as
noise: it names the description models keep misreading, which is the loop that keeps this honest
instead of relying on anyone noticing a bad call.

Timeouts are counted separately from genuine failures. This includes registry execution limits
and a `wait_for` condition that was not reached, so exploratory waits no longer inflate the error
count. Telemetry is best-effort: subscribers must not break tool calls, and the registry swallows
subscriber errors after the model-visible result is produced.

## Turn trace

Separate from telemetry, the project rail's "Turn trace" opens a live view of everything the main
process saw a model do: turn start and end with duration, every registry tool call with its
full arguments and result (`registry.observe`), each normalized transcript item and context
update, and the raw JSON lines exchanged with each provider process (Codex app-server, the
Claude Agent SDK, the `agy` CLI). It exists so the user can see where a turn went wrong without
reading logs.

The trace is held in memory only (`src/main/trace/trace-log.ts`): at most 4,000 entries and
24,000,000 detail characters, each detail clipped at 48,000 characters before its truncation
marker. It clears at restart or with the panel's "Clear" button. Trace data is not written to
disk; providers separately retain their own conversation histories. Raw provider lines are
hidden by default in the panel's filters, but still collected in the in-memory ring. Oversized
nested strings are clipped before JSON encoding so recording an image does not encode its full
base64 payload just to discard it. Serialization still runs synchronously and traverses objects.

The performance summary (`renderer/trace/trace-performance.ts`) derives model passes, cache/token
usage, context, and tool time from the available entries. Codex and Claude raw messages supply
token summaries; Antigravity and Cursor currently have no equivalent token-summary parser. Truncated or
evicted entries limit these estimates. This is a local diagnostic view, not a persisted ledger.

`trace/response-latency.ts` adds bounded, monotonic-clock request timing to that ring. For sends
through the pane manager, `response.first_text` contains Send-to-first-text elapsed time,
preparation before the actual outgoing provider message, the measured Codex compaction wait
within preparation, and the remaining time after dispatch. These timings appear in the Turn
trace summary without requiring raw rows to be visible. They include the first commentary text;
reasoning, tool output, empty text, history replay, and pre-dispatch compaction turns do not count.
A dispatched request ending without assistant text emits `response.no_text`, not a zero-latency
sample. Failed sends are discarded; clearing the trace also discards pending measurements.

These are main-process observations, not provider token-generation timestamps or renderer paint
times. Provider-internal compaction, queueing, prefill, reasoning, and tool execution can all be
inside the after-dispatch interval. A zero app compaction wait does not prove zero provider
compaction. Background/provider-initiated turns have no Send timing. The new tracker stores no
conversation text and retains at most 256 pending requests. Compare the same model/effort and
representative task with the budget off/on, including warm/cold-cache cases; measure recall of
old constraints as well as median/tail first-text latency. Unit tests establish timing/policy
semantics, not a live performance improvement.
