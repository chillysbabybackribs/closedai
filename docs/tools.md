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
| `investigation` | `read` | `list`, `read` | Chat/project-private durable artifact descriptors, verified byte pages, provenance and JSON-pointer projections; source content remains untrusted. |
| `investigation` | `manage` | `import`, `export`, `delete` | Explicit file retention, verified no-clobber artifact export and scoped deletion. Protocol command retention uses the same worker store. |
| `credential_vault` | `list`, `read` | — | Gives every provider access to credentials saved in the app. `list` returns labels, ids, types, and masked field metadata without decrypting secrets. `read` requires one credential id, exact field ids, and an audit reason; it returns only those values, rejects `tool_batch` aggregation, and marks its result sensitive so the Turn Trace records a redacted placeholder. Shared model instructions allow reads only for the current user-requested operation and prohibit echoing, logging, or persisting retrieved secrets. |
| `embedded_browser` | `page` | `navigate`, `read_page`, `wait_for` | Browser-page inspection for the pane the user can see. It can open a URL or search query in an explicit `tab_id` (or the active tab by default), wait for page readiness, and read visible text from the whole page or one selector. `tab_id` and `new_tab` are mutually exclusive. For fetch, extract, query, evaluate, and console use `embedded_browser.script`. |
| `embedded_browser` | `script` | `fetch`, `extract`, `query`, `evaluate`, `console` | Page scripting and structured extraction, deferred where supported. `fetch` issues a request from inside the tab, so it inherits that tab's origin, cookies, and signed-in session — the way to reach a same-origin API the page itself calls, including POST endpoints. `extract` projects a JSON document (`path` to a subtree, `fields` per item, `limit` rows) so a large response costs only the part that was asked for. `query` returns structured facts (tag, id, classes, role, name, text, value, href, src, disabled, checked, visibility, bounds, named attributes) for every element matching a selector, with `text_contains` and `visible_only` filters. `evaluate` runs JavaScript in the main frame through the WebContents the app owns (an expression, or statements with `return`; promises awaited) and returns a bounded JSON value with DOM nodes summarised and cycles cut. `console` lists the tab's captured console messages and page errors with navigation markers, `min_level`, `since_navigation`, and cursor paging. None attach a debugger. |
| `embedded_browser` | `network` | `requests`, `wait`, `rules`, `add_rule`, `remove_rule`, `clear` | The session's always-on request record, captured in the main process from Electron's `webRequest` hooks (`src/main/browser-network/`): every request from every tab and from the session itself, with method, resource type, status, request and response headers, timing, redirects, post data, cache flag, and error, kept across navigations in a 2,000-record ring with cursors. `requests` filters by tab, URL substring, type, method, status, state, and `after_cursor`; `wait` resolves when a matching request finishes after a cursor taken before acting, so the request an action triggers is the one returned. This log has no historical body reader: its ids cannot be correlated exactly with CDP by URL/method. Use `browser_cdp.protocol requests/body` for captured responses. Rules act at the session's blocking stages without pausing the page: `block`, `redirect`, `request_headers`, and `response_headers` (null removes), scoped globally or to one tab, with hit counts. |
| `embedded_browser` | `session` | `fetch`, `cookies`, `set_cookie`, `remove_cookie` | The user's signed-in session used directly by the main process. `fetch` sends through Chromium's network stack on the browser partition with the session's cookies and no CORS policy, so cross-origin APIs that reject a page's fetch answer here; it returns status, response headers, redirect facts, and the body (JSON parsed when it fits `max_chars`, text otherwise, binary as base64 with byte length). A large JSON response is projected rather than truncated: `json_path`, `fields`, and `limit` run before serialisation, the same projection `page.extract` uses. For HTML documents, `format: 'text'` extracts clean prose and document title, stripping scripts, styles, and navigation chrome. Cookie actions read and write the cookie store for any domain or URL, no page required. |
| `closedai_ui` | `capture` | `app_window`, `browser_page`, `crop` | Visual evidence, deferred where supported. The first two actions capture the composed app or one readiness-gated page; `crop` enlarges a retained region. The model receives a scaled JPEG (max 960×720); the retained display image (up to 1920×1440) goes to `ScreenshotStore`. |
| `closedai_app` | `state` | plain tool | Compact app facts from the main process (workspace panes, a chat pane, browser tabs, downloads, window) plus renderer-only ui facts (open dialogs and menus, drawer, history panel, composer state, focused control). No DOM walk; sections are selectable. |
| `closedai_app` | `command` | `new_chat`, `send_message`, `stop_agent`, `open_chat`, `close_chat`, `select_model`, `browser_tab`, `project_switch` | Deterministic commands over the same services the renderer's IPC calls. `browser_tab` covers tab-strip actions including targeted reload, duplicate, rename, and bulk close. `send_message` can await the target pane's turn; sending to or stopping the calling pane is refused. `project_switch` uses `project_op: request` with an absolute `project_path` to queue a switch after all chats become idle, or `project_op: cancel` to release the caller’s pending request. Finish the turn after acceptance; inspect `state.workspace.projectSwitch` for pending/switching/completed/cancelled/failed and a destination pane or error. The destination receives a new chat with the caller’s bounded handoff and a continuation of the authorized task. Completed means switch verified and continuation submitted. Requests are in memory; a failed sequential batch cancels its queued switch. |
| `closedai_app` | `ui` | `controls`, `click`, `type`, `press_key`, `scroll`, `wait_for` | Renderer inspection plus exceptional real interaction by stable control id (`data-ui`, manifest in `src/shared/ui-controls.ts`). Click, type, and key actions require `fallback_reason`; deterministic `state`/`command` operations come first. |
| `browser_cdp` | `page` | `inspect_page`, `click`, `click_at`, `type`, `press_key`, `scroll`, `dismiss_overlay` | Semantic page inspection plus exceptional real CDP input, deferred where supported. Input actions require `fallback_reason`; `fetch`/`extract`, site APIs, and non-input protocol operations come first. |
| `browser_cdp` | `protocol` | `capabilities`, `targets`, `command`, `target`, `events`, `requests`, `body` | Advanced CDP fallback, deferred where supported. Start with `embedded_browser` for pages, recorded requests, and signed-in APIs. CDP `requests` and `body` remain available for captured protocol traffic; `requests` leases Network capture into every attached frame and worker, including late ones, and reports `childSessions`. Raw `Input.*` commands require `fallback_reason`; screenshots remain ordinary commands. Target inventory exposes flattened child sessions; `target` wraps attach/detach/create/activate/close. See [CDP](cdp-tool-foundation.md). |
| `browser_cdp` | `profile` | `start`, `stop`, `metrics` | Cost measurement folded in the main process. `start` arms JS byte coverage, CSS rule coverage, and heap allocation sampling by default; `cpu` must be asked for explicitly and is refused alongside `script`, because precise coverage and the sampling profiler are both Profiler-domain recordings over one V8 isolate and arming both was measured here to fail the next navigation to a heavy page with `ERR_FAILED` and to crash the renderer on a retry. Every channel's stop is bounded and reports under `unavailable` rather than stalling. `stop` returns per-URL used/unused bytes, per-function self time, and per-site retained bytes, ranked worst-first. The raw protocol payloads cannot cross the tool boundary — one `Profiler.takePreciseCoverage` on an article page measured 949,330 characters — so the arithmetic happens in `src/main/cdp/cdp-profile.ts` and only the answer is returned. CSS rule usage arrives as a delta of *used* rules, so unused bytes are measured against the stylesheets' own text, and heap sampling is re-armed on each main-frame commit because V8 restores the profiler and coverage agents into a new document but not the sampler. `metrics` is a cheap snapshot with nothing armed. |
| `browser_cdp` | `instrument` | `hook`, `recording`, `unhook` | Pre-document API recording. The recorder is installed with `Page.addScriptToEvaluateOnNewDocument`, so it wraps selected fetch, XHR, WebSocket, cookie, storage, fingerprinting and error APIs before document scripts run. It survives navigations and is leased into every cross-origin frame target, including frames created later, which start paused until it is installed; workers are not recorded. Eval/Function are never wrapped. Wrappers are observable and may affect behavior. `recording` reports per-feature patch installation/failure, observed counts, frequent retained calls and recent events. Unhook disables current recording, restores owned descriptors and removes listeners without overwriting page replacements, in the root and in every recorded frame (`frames`). |
| `browser_cdp` | `emulate` | `apply`, `reset` | Device and environment emulation that actually lands. `Emulation.setDeviceMetricsOverride` alone applies screen metrics, `devicePixelRatio` and touch points but leaves the layout viewport following the headful widget, so a responsive site keeps serving its desktop breakpoint; `apply` therefore also shrinks the tab's native surface to the emulated viewport (`BrowserTab.setEmulatedViewport`), the way DevTools device mode resizes the inspected view. Presets plus user agent, colour scheme, reduced motion, timezone, locale, geolocation, network throttling and CPU slowdown. Every result carries the page's own measurement, so an override that did not land is visible rather than assumed. |
| `search` | `query` | plain tool | Routed public-web search across Brave, Exa, Serper, Tavily, and You.com, with normalized, deduplicated results and bounded in-memory caching. Defaults to `depth: quick` (one provider) and `presentation: live` (reuse one tab per pane/thread/turn); `live: true` bypasses the ten-minute cache and refreshes it with current provider results. |
| `search` | `library` | `status`, `search`, `read` | Read-only, durable app-shared public paper index. Local lexical search returns five results by default (maximum ten, 400-character excerpts); read returns one saved abstract up to 6,000 characters. No network/model calls or automatic prompt injection. Manual alphaXiv refresh and retrieval permission live in Tools → Research library; see [contracts and limits](research-library.md). |
| `search` | `run` | `start`, `extend`, `expand`, `cancel` | Incremental public-web research with adjustable source coverage. Exa page text is retained as `provider_text` without a fetch/read slot. Live presentation opens an actual source tab. `extend` adds discovery to active runs; `expand` refetches a selected source even after completion. |
| `search` | `read` | `results`, `wait`, `source` | Cursor-based source updates, bounded event waits, and retained document excerpts. Observes the calling pane/thread's runs without starting more requests. Oversized wait and excerpt budgets are capped at 20 seconds and 12,000 characters rather than rejected. |
| `search` | `pdf` | `page`, `ocr` | Local, cancellable inspection of one retained PDF page/crop. Returns page images or separate English OCR text with byte identity, coordinates, and explicit limits. No refetch, upload, or automatic correctness/visual-verification claim. |
| `peer_chats` | `list`, `read` | plain tools | Read-only status and paginated transcript access to other panes and visible subagent summaries. `read` is deferred where supported; it takes an id from `list` and pages the newest 30 items backwards by default (at most 100), inside a serialized budget (`max_chars`, 6k default, 16k ceiling) that clips long tool detail, output, diffs and screenshot data URLs and reports `totalItems`; `order: "oldest"` follows a chat forward and `types` narrows to the item kinds wanted. It does not start or control agents. Reasoning items are excluded from both previews and pages, matching `recall` and thread handoff, so one model's thinking never enters another model's context. |
| `peer_chats` | `recall` | plain tool, read-only | Bounded phrase search or exact-message excerpts from the caller's current chat, frozen direct continuation source (live in-memory transcript after same-pane rotation), or a previous conversation across projects, plus saved checkpoint state and optional `sessionRotationEpoch`. |
| `peer_chats` | `checkpoint` | plain tool, writes notes | Revision-checked replacement of the caller's structured working notes; cannot control sessions or write other panes. |
| `tool_batch` | `run` | plain tool | Runs up to 16 other tools by default, sequentially or in parallel by resource. Set `continue_on_error: true` in sequential batches to run remaining steps despite earlier failures while still unwinding unreleased armed state. Same-target work serializes; distinct explicit browser targets can run concurrently. When the outer batch ends or times out, its signal cancels in-flight inner calls, releases their resource locks, and prevents queued calls in that target lane from starting. `toolBatchMaxCalls` configures 1–64 at startup; nested batches are refused. A failed sequential batch compensates itself: browser state armed by earlier steps that nothing on screen reveals — profiling recorders, a pre-document hook, device emulation — is released in reverse order and reported, including after a batch timeout, because the plan that justified arming it no longer holds. State a completed step deliberately released is not released twice, visible or consequential mutations (an opened tab, a cookie, a network rule) are never undone, and parallel calls are declared independent so a failure does not unwind them. See `src/main/tools/batch/compensation.ts`. |

`embedded_browser.network_replay` is a separate deferred tool taking `request_id` from the
session request log. It always sends a new request using the recorded method, replayable
headers and post data with current session cookies. It can repeat mutations. Missing records
and incomplete/binary/file upload bodies fail before sending. Its response is never historical
evidence. The removed `network body` action now fails schema validation without dispatch.

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
removes it from the tile without stopping its turn or deleting history; items are chat ids.
`layout.new-chat`, `layout.split-right`, and `layout.split-below` are rows of the header's
`layout.new-chat-menu` dropdown, so open that menu first; the browser toggle is a plain header
button. Their item is the chat id.
With multiple visible tiles, `layout.new-chat` starts a fresh chat in the tile named by its item
without changing the other tiles or the split geometry.
`composer.new-chat` opens a new tab in the focused tile, preserving the original chat and draft.
The sidebar context menu's `drawer.row-split-right` and `drawer.row-split-below` open or move the
row's existing chat alongside the focused pane; their item is the chat id.
Hiding a tile keeps its turn running; `close_chat` still detaches and stops it. A hidden browser
keeps its tabs, but semantic page input still requires a visible page.

### Application facts, browser targets, and batching

`embedded_browser.page read_page` reads a PDF already loaded in Chromium's built-in viewer
using native PDF accessibility text. `pdf_page` is one-based and defaults to 1; `max_chars`
bounds that page's text. Select the PDF tab first: hidden PDF views may not construct their
native accessibility tree. `selector` remains an HTML-only option and cannot accompany
`pdf_page`. Selecting text with `pdf_page` does not navigate the viewer; move the viewer to
the relevant page before capturing visual evidence. The result identifies its source,
requested page, total pages when available,
and clipping. An unavailable page is an error; an empty native page is explicitly described
as possibly scanned, blank, or inaccessible. Use the existing browser capture for the visible
page's figures, equations, and layout. Capture remains viewport evidence, not a full-document image.

The adapter in `browser-pdf/` uses a disposable, sandboxed `chrome://accessibility/` WebContents
to request Chromium's native PDF tree. This is Chromium's internal diagnostic interface, not
a stable public PDF extraction API. CDP's Blink accessibility tree did not expose the PDF
plugin text in the tested Electron 44.1.1 / Chromium 152.0.7977.65 build. The helper resolves
the native view from the target renderer and URL, rejects ambiguous matches, and releases
its scoped accessibility mode when closed. It does not change global accessibility flags,
select/copy text, fetch the document again, or run OCR. Cancellation and a nine-second deadline
close the helper; main-frame navigation/renderer loss invalidate the result. Tree input is
capped at eight million characters. Recheck the internal adapter on Electron upgrades using
`scripts/pdf-native-live-check.mjs` with the benchmark's local `columns.pdf` and `book.pdf`.

Native text does not establish complete reading order, table structure, math fidelity, or
image coverage. The scan checked in this build returned no text: Google Chrome's separately
distributed Screen AI OCR must not be assumed present in Electron. Research PDFs retained by
`search.run` continue to use the independent `search.pdf` rendering/OCR path described below.

Browser strip snapshots include app-owned image tabs, identified by `image` metadata.
They support strip commands (select, close, rename, duplicate), but have no native web page
or CDP target. Select a web tab for page tools, or use the `image.*` app controls for zoom,
fit, pan, download, and reveal. Image bytes are not included in tool state or tab events.

`investigation.read` offers `list` and `read` for durable artifacts; `investigation.manage`
offers `import`, `export` and `delete`. Both are provider-neutral and deferred where supported.
`browser_cdp.protocol command` accepts `retain: true`, with explicit `tab_id`, `operation_key`
and `label`, to store the complete host response JSON before normal output truncation. It
returns a compact artifact descriptor instead of inline data. Raw commands retain their
ordinary effects and input checks. Ordinary commands without retention behave as before.
See [artifact contracts, examples, limits and verification](investigation-artifacts.md).

For exact network evidence, `browser_cdp.protocol requests` retains repeated URLs and child
`sessionId` identities. Pass that value as `session_id` to `protocol body` for child traffic.
This body path never reissues requests. Resource timing is discovery only, not request-level
correlation. The former `embedded_browser.network body` action is removed; use the separate
`embedded_browser.network_replay` tool only to deliberately issue a new request. It may repeat
server-side effects and always labels the result `source: replay`. These capabilities serve debugging,
integration, extraction and other applicable tasks as well as recon.

Use `closedai_app.state` for app facts, `closedai_app.command` for service operations, and
`closedai_app.ui` only for exercising real controls when deterministic service operations cannot
complete the task. Browser-page DOM and CDP targets
belong to the browser tools; app renderer controls belong to `closedai_app.ui`. Workspace state
shows at most 12 panes, prioritizing selection, caller, running panes, and real conversations;
`omittedPanes` reports any remainder. Browser/download lists are also bounded.

`tool_batch.run` defaults to sequential execution with stop-on-error. Pass `continue_on_error: true`
to continue running subsequent sequential calls when an earlier call fails, while preserving
automatic compensation for unreleased armed state at the end. In parallel mode, calls
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
as retrieved document evidence; runs explicitly disable discarded Tavily/You answer synthesis.
Standalone answer lookups retain it and use separate cache entries. Index overlap in both query
and run results is reported as `discoveredBy`, not factual corroboration.

Runs also set `sourceText`, which asks providers that extract pages to return the text itself. Exa
does: each result arrives with query-guided highlights (the snippet) and compact page text.
`max_text_chars` on the run sets extraction and retention coverage (default 120,000; zero removes
the application character cap). The research service retains that text immediately under the source id as
representation `provider_text` with `contentProvider: "exa"`, without a fetch and without consuming
a read slot, so `max_sources` bounds fetched documents only. Text that reached Exa's cap is marked
`incomplete`. This indicates a known limit, not a guarantee of complete content or layout fidelity
when false. Provider text has no byte-level provenance of our own — its `sha256` covers the text
as delivered — and a source already queued for fetching keeps its fetch. If local retention fails
the source returns to `deferred` and the ordinary reader may still fetch it. Standalone
`search.query` never requests page text; Exa highlights alone become the snippet there.

`search.run.expand` accepts `run_id`, `source_id`, optional `method: auto|direct|exa`,
`max_text_chars` (default zero/uncapped), and `max_source_bytes` (default 8 MiB). It awaits one
new extraction, without discovery or consuming an initial read slot. `auto` uses Exa Contents for
Exa-supplied text, otherwise the direct reader with rendered-shell fallback; `exa` explicitly
requests provider text for another source, including a failed direct PDF read. Exa Contents
requests uncapped compact/main-body text by default and may incur extraction charges. It keeps
Exa's normal cache/fetch policy; expansion establishes neither freshness nor every page section;
see [Exa Contents](https://exa.ai/docs/contents/quickstart). Two Contents requests can run at once.
The operation has a 45-second deadline; direct reads retain their 20-second deadline.
It works on retained completed runs in the same pane/thread/workspace during an active turn.
Stop, cancellation, turn replacement, and shutdown abort expansion as well as initial reads.

Expansion stages files under a temporary id, then atomically publishes a revision pointer for
the corresponding text and original bytes. Old revisions remain until run eviction, so readers
holding them stay valid. Provider-only replacements never inherit earlier PDF bytes. A failed
or shorter extraction preserves the earlier text/hash; `expansionError` explains the failure or
nonreplacement. Source id, requested URL, and discovery provenance remain; representation,
content provider, resolved URL, retrieval time, hash, and offsets describe the replacement.
Read excerpts again after a successful expansion. `expanding` and `pending` expose outstanding
expansion even when the initial run is completed. Duplicate expansion of the same source is refused;
active expansions prevent run eviction. Exa text for a PDF URL remains provider extraction.
Neither uncapped extraction nor local PDF text establishes OCR, table, equation, image, or page-layout fidelity.

Exa discovery uses `POST /search` on Exa's own index with `type: fast` for quick and `auto` for
balanced and deep requests (the `deep*` types synthesize answers over tens of seconds and are not
used). `freshness` windows become `startPublishedDate`; validated `YYYY-MM-DDtoYYYY-MM-DD` ranges
become inclusive published-date bounds, so date ranges route to Brave and Exa rather than Brave
alone. Include/exclude domains, `country` (as `userLocation`), and the news category map directly;
Exa has no language filter, ranking boosts, or relevance threshold, so those controls still select
Brave. Exa's `publishedDate` is recorded as an `index_reported` date, not a verified publication date.
Routing: research quick/balanced/deep is Exa, Exa+Tavily, Exa+Tavily+Brave; general and technical
deep add Exa as the third index.

Brave discovery uses its `/res/v1/llm/context` endpoint rather than human-oriented Web Search.
The adapter returns extracted grounding chunks as normalized snippets and uses source metadata for
page age. Quick, balanced, and deep requests consider 10, 20, and 50 candidates with 2,048,
8,192, and 16,384-token context budgets respectively; the requested result count remains the
maximum number of returned URLs. Relevance defaults to strict for quick, balanced for both balanced
and deep; broader discovery does not automatically relax relevance. `relevance` and `context_tokens`
override these controls independently. `preferred_domains` generates inline Brave Goggles boosts
without excluding other domains; `goggles` accepts custom inline rules or a Goggle URL instead.
The two ranking inputs are mutually exclusive. `freshness` accepts day/week/month/year or a validated
inclusive `YYYY-MM-DDtoYYYY-MM-DD` range. These advanced controls narrow routing to the providers
that implement them (Brave for ranking, relevance, and context budgets; Brave or Exa for date
ranges); explicit provider requests outside that set fail with advice to issue a separate query,
never silently drop unsupported filters. Domains remain discovery preferences, not proof of authority. Queries including
domain filters over Brave's documented 600-character/75-word limit fail rather than silently
truncating constraints. `live: true` adds Brave's best-effort no-cache header.

Query results expose `observedAt` and per-result discovery timestamps/cache status. Reusing a cached
query preserves its observation time. `live` bypasses the app cache; it does not establish that an
upstream index or source is current. Source dates retain their provenance: provider-reported ages
are `index_reported`; explicit HTML publication/modification metadata and HTTP Last-Modified are
separate observations. Unknown/ambiguous dates remain unknown. Collected sources preserve their
requested URL separately from the resolved URL. Date assertions remain untrusted source data.

One registry-wide router admits four provider requests, at most two per provider, across both
synchronous queries and research runs. Providers have twenty-second deadlines. A separate source
reader admits eight HTTP reads, at most two per starting origin. Both queues alternate eligible
owners. The source reader currently does not retry or honor Retry-After; failures remain visible.
Redirects stay under the starting-origin slot. These are initial bounds, not measured optimal
settings or a complete per-origin rate policy.

Runs default to twelve document reads and a 45-second deadline; callers may select 1–20 reads
and 1–120 seconds. They retain up to 80 deduplicated candidate descriptors separately from the read
budget. `sourceCount` counts candidates, `readCount` counts admitted read attempts (including failures),
and `omittedCandidates` exposes candidate overflow. Supplied URLs receive first priority, then
preferred domains, then ordinary discoveries; ties favor origins with fewer admitted reads.
At most eight reads per run are admitted concurrently, under the existing global reader limits.
There is no additional model call or wait for all engines before admitting useful sources.

`reserve_sources` reserves up to two slots by default for supplied URLs/preferred domains, leaving
at least two ordinary slots for budgets of two or more. Set zero to spend the full budget on general
discovery. Candidates that were not read remain `deferred`; they are not evidence. Supplying a deferred
candidate URL to an active run promotes it within the remaining read budget. Once a run finishes,
start a new run with the selected URL. Reserved slots do not keep an otherwise idle run alive.
`selection` explains read priority, not credibility. No automatic recursive crawling is introduced.
At most eight runs are active, and 32 completed/active runs are retained.
Stop, pane detachment, turn replacement/completion, and shutdown cancel owned
background work. Read needed evidence and cancel unnecessary pending work before ending the model
turn; ready sources remain readable after cancellation. Completed means work settled and can include
failed reads or deferred candidates, not that the user's question is answered. Completed runs remain readable
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
streamed to a raw file (default 512 KiB, adjustable with run `max_source_bytes`; zero removes
the byte cap), HTML is parsed inertly with parse5, and extracted text uses `max_text_chars`.
The text limit also applies to rendered/provider text; the direct byte budget does not control
provider or rendered-page downloads. Truncation is explicit. JSON and text are also supported.
PDF bytes are parsed locally with Mozilla PDF.js in a disposable Node worker, at most two at
once, with a 256 MiB V8 old-generation limit per worker. Cancellation or the direct-read deadline
terminates the worker. It receives only downloaded bytes from the app-owned temporary file and
uses packaged font/CMap assets; it does not load the source URL or execute document JavaScript.
`application/pdf` and PDF signatures in otherwise accepted bodies (including generic/missing MIME)
are recognized. A PDF requires the complete body: exceeding `max_source_bytes` fails with guidance
to expand using a larger byte budget or zero; truncated PDF bytes are never published as text.
Results use `pdf_text`, `[Page N]` markers, and `pdf` coverage: `totalPages`, `extractedPages`
(pages processed, including a character-clipped final page), and `pagesWithoutText` among processed
pages. The hash covers retained text. Character limits or pages without text mark `incomplete`.
`pdf.documentSha256` and `pdf.bytes` identify the original PDF separately from the text hash.
`pdf.textStatus: none` means no native text was found among inspected pages; the source remains
ready with retained bytes for page inspection/OCR, and `incomplete` is true. Empty/scanned pages
cannot be distinguished by text extraction. Password requirements and parsing failures still fail.
Explicit Exa expansion remains available as provider extraction.

`search.pdf page` renders one selected page or normalized crop from those retained bytes, without
refetching. It returns a JPEG, the original byte hash, page number, dimensions, effective DPI,
and pageable native text plus optional text-item transforms. Native text/items cover the whole
page even when the image is cropped; they are not reconstructed columns, tables, or reading order.
Page numbers are one-based. Crops use top-left fractions of the rotated page; width/height are
at least 0.01 and the crop must fit inside the page. DPI defaults to 144 for page, 216 for OCR,
ranges from 72 to 216, and is reduced to fit a maximum 2400 pixels per edge. PDF.js can omit
embedded rasters above 16 million pixels or unsupported content, even with stopAtErrors enabled.
An empty drawing-operation list marks `renderIncomplete` and `incomplete`: it can mean a blank
page or a failed render. Nonempty operations do not prove fidelity; results disclose this limit.

`search.pdf ocr` explicitly runs local Tesseract.js on one page/crop, including mixed native/image
pages. English model data ships as a dependency; there are no runtime model downloads or document
uploads. OCR text is separate from native text and has engine/language, confidence (not correctness
probability), and optional word boxes in rendered-crop pixels. Empty OCR is marked incomplete.
Results retain up to 120,000 characters and 5,000 items per page, flagging clipping; tool excerpts
default to 3,000 characters (maximum 6,000) and zero items (maximum 30). Use offset/item_offset
and nextOffset/nextItemsOffset to page. OCR results are cached separately by PDF revision and
rendering settings; paging identical settings does not rerun recognition. The cache lives with
research evidence, is removed with its run, and is cleared on restart.

Both actions require the owning pane/thread and an active unstopped turn, pin the run against
eviction, serialize against expansion of that source, and abort on cancellation, turn replacement,
or shutdown. There is one inspection worker at a time, separate from the two text-parser slots,
with a 60-second deadline including queue time. Workers have 256 MiB V8 old-generation limits;
these are not total limits on native canvas/WASM memory. Abort terminates the worker and its
Tesseract child. Page images are explicit research evidence and do not use the UI screenshot
tool's two-image allowance; each call is limited to one page/crop. Code-mode callers split at
the final newline-prefixed image data URL and pass it to `image()`, never print the whole payload.
Rendering and OCR do not set a verification flag. Models must inspect images before visual claims
and describe which pages/regions were checked; table, equation, figure, and OCR accuracy remain
unverified unless checked. Provider-only sources need `search.run expand method=direct` first.

Redirects are followed by the
transport; the resolved URL is retained when available, alongside the requested source URL.
Parsing does not execute JavaScript or resolve
CSS visibility and is not a rendered-page verification. A page whose static body is empty, or a
script-bearing shell with under 200 characters of text, is loaded once in a hidden page worker
(`src/main/browser-workers/`): an ordinary `BrowserTab` on the same public research session,
outside the tab strip, recording no history and dropping popups. At most three workers exist
process-wide and two serve one run; a worker waits up to eight seconds for the page text to
settle, the whole rendered read is bounded to thirty seconds, and idle workers close after
thirty seconds. Sources report `state: rendering` while that happens and
`representation: rendered_text` (page `innerText`) or `static_text` when ready; `search.read
source` echoes the representation. When no worker text is available the static outcome stands:
sparse static text is kept, and an empty body is a failure naming both reads. Stop and run
completion abort in-flight rendered reads.

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
Live target transfer, showing a worker's page to the user, dedicated progress UI, and
Follow/Take over controls remain later slices.
`live: true` on each query still controls cache freshness only.

Regression coverage includes omitted presentation on both tools, turn-scoped tab reuse, explicit
background, and two isolated Chromium checks using a temporary bundle and profile without
rebuilding or restarting the user's app: `node scripts/search-live-check.mjs` loads a real browser
page through the production runtime while a local source response remains pending, and
`node scripts/research-workers-live-check.mjs` proves hidden workers render script-only pages
without the user's browser session, follow redirects, and keep popups out of the tab strip.

The production search pipeline (real API credentials, `SourceStore`, live source tab, `search.read`
excerpts) is verified with `npm run search:pipeline` (`scripts/search-pipeline-live-check.mjs`).
Requires at least one search API key documented below; `CLOSEDAI_LIVE_VERIFY_PROVIDER=exa` (or any
provider id) pins the lane instead of taking the first credentialed one. The request goes to the
already-running app when one owns the profile, so that app must be built from the current tree.

### Search credentials

Search providers read credentials from environment variables first and the Linux Secret
Service keyring second. The supported environment variables are `BRAVE_SEARCH_API_KEY`,
`EXA_API_KEY`, `SERPER_API_KEY`, `TAVILY_API_KEY`, and `YOU_API_KEY`. Desktop keyring entries use
service `codeapp-vault` and accounts `brave_paid_search`, `exa_api_key`, `serper_api_key`,
`tavily_api_key`, and `you_api_key` (for example
`secret-tool store --label='Exa' service codeapp-vault account exa_api_key`). A query succeeds when at least one selected provider succeeds;
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
`dynamicTools` for `thread/start`, and calls arrive as `item/tool/call`.
The installed Codex 0.154 protocol restores saved tools on resume and does not accept a replacement
catalog there. ClosedAI reads the bounded rollout metadata and compares that catalog with the
enabled registry before sending. A changed or unreadable catalog starts a fresh provider thread
through the existing session handoff, preserving the visible transcript and source recall. The
new user message is excluded from that handoff. Unchanged catalogs reuse the resumed thread;
tool-switch changes also take effect before the next send. This refresh is independent of the
idle context-rotation preference. A failed thread start retains the prepared handoff for retry.
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
- Browser-page capture rejects main-frame navigation (including reload/same-document changes)
  and renderer loss from before readiness through image return. `browser-capture-guard.ts`
  removes its listeners in `finally`; the host also releases its rendering lease. This prevents
  attributing a later document's image to an earlier readiness result. It does not freeze DOM,
  animations, canvas/video, or subframes, and is not an atomic DOM/pixel snapshot.
- Each browser-page capture reports its coherence (`capture-coherence.ts`): the interval from
  readiness to pixel read, how the frame was established, the DOM mutations observed meanwhile,
  and a verdict. A visible document must paint two animation frames (`painted`); a hidden
  document cannot run them, so after a 60 ms compositor catch-up beat consecutive captures must
  be byte-identical within 400 ms (`settled`), otherwise `unsettled`. A visible page that did not
  paint within the wait is `unconfirmed`. The verdict is `verified` only for a fresh frame and a
  quiet DOM; `dom_changing`, `pixels_changing` and `possibly_stale` mean the image is delivered as
  unverified evidence. The hidden compositor coalesces rapid changes, so frame agreement alone
  never verifies a hidden tab; the DOM count is the other half. Measured in
  `node scripts/capture-coherence-live-check.mjs`: a hidden tab recolored between captures is
  recaptured with its new colour and no paint-probe timeout, a flickering hidden tab and a
  churning visible tab are delivered without the verified verdict.
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
  When `chatSeamlessRotation` is enabled (default on), the same idle thresholds rotate Codex and
  Claude to a fresh provider thread with a thin seed instead of calling native compact; mid-turn
  Codex overrides and Claude auto-compaction are skipped. The Turn trace records `session.rotated`
  (including release elapsed ms) and the UI stays unchanged; Antigravity manual compact is hidden.
  See `src/main/chat-context/session-rotation.ts`.
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
way. 32k is an evaluation starting point, not a measured optimum. With `chatSeamlessRotation`
enabled (the default), these thresholds trigger session rotation; set it to false to evaluate
native compaction instead. Neither path automatically generates the model-written checkpoints
described below.

## Working memory and recall

`peer_chats.list` retains `scope: open` as the peer-status default. `scope: history` discovers
previous conversations, including closed chats across projects, using existing records without
loading transcripts. It excludes the caller, archived chats, and empty chats. Entries contain
`chatId`, `threadId`, title (120 chars), preview (240 chars), `cwd`, and `lastActivityAt`, ordered by
most recent user submission; older records fall back to turn completion or creation. Background
completion and pinning do not outrank a recorded user submission. `limit` defaults to 5, max 8;
the serialized result fits within 16k characters and may return fewer entries to fit. Page with
`nextBeforeChatId` as `before_chat_id`. A missing cursor is an error. `query` is a literal
case-insensitive metadata filter over title, preview, project directory, and applicable checkpoint
notes, not transcript search. `cwd` optionally narrows discovery to a project directory. History
arguments require history scope. Explicit older references outweigh recency in shared guidance.

`peer_chats.checkpoint` writes a small structured checkpoint only for the calling pane's active
thread/turn. It requires `expected_revision` (0 when absent) and `state` with `goal`, `constraints`,
`decisions`, `progress`, `nextSteps`, and `files`. Goal is at most 1,000 characters; each list has
at most 12 non-empty strings of at most 400 characters. The whole serialized state must fit
6,000 characters. Oversized or stale-revision writes fail without replacing the checkpoint.
The response contains revision and boundary metadata rather than echoing the entire state.
One checkpoint per chat is persisted in `ChatStore` (`chats.json`), not a separate transcript
database. It is model-authored data, not an approval or independently verified work record.

`peer_chats.recall` is read-only and accepts `scope: current|source|history`, optional literal
case-insensitive `query`, `types` (defaults to user/assistant messages), `limit` (default 5, max 8),
or `item_id` with a character `offset`. History accepts `chat_id` from discovery, defaulting to
the most recent other conversation when omitted, and returns its `chatId`. `chat_id` is rejected
with other scopes. Tool, plan, command, and file-change evidence can be requested through `types`.
Search results contain at most 800 characters per excerpt and fit within 16,000 serialized
characters including checkpoint state. Use `nextOffset` to read more of a matched item, or
`nextBeforeItemId` as `before_item_id` to search older items. `hasMore` means older candidate
items remain, not necessarily more query matches. Screenshot and reasoning items are excluded;
user/assistant/plan text and textual tool/command/file-change evidence are eligible. File/image
attachment contents are not fetched. Queries are literal phrases, not semantic/vector search.

The current scope reads the caller's existing transcript. Source scope uses only the direct
continuation source and its frozen last-item id; later messages are excluded even when the
original pane keeps running. A source with no recoverable boundary is unavailable rather than
read without limits. History scope separately reads previous chats across projects without that
continuation bound. Closed or empty parked panes use existing provider history readers with the
source project directory, without selecting that chat in the UI. Cursor queues concurrent history
loads so its shared replay collector cannot mix transcripts. Those readers can still load a full transcript in main before selection;
this does not yet optimize provider-history disk/RPC transfer. Provider compaction, missing
history, or id changes can make old evidence unavailable. A history chat id resolves through app
records, rather than accepting an arbitrary provider thread id. Workspace/thread changes, target
thread changes or archival, and cancellation invalidate pending reads.

Recall and checkpoint are deferred where supported. Checkpoints remain optional. Routine retrieval
does not require user-facing narration, but relevant uncertainty and requested sources are disclosed.
Continuation copies applicable notes into the existing
bounded handoff, marked untrusted; later conversation can supersede those notes. There is no
new model call on Send from recall or checkpoints. Idle session rotation is a separate mechanism
described above. Disabling the checkpoint
tool prevents new model writes; existing notes/history are not deleted.

## Seeing what exists: the Tools modal

The title bar's Tools menu opens tool configuration (`src/renderer/tools/`). It reads
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

Research adds content-free `research.started`, `read_started`, `first_source`, `read_finished`,
and `finished` notes to the existing trace when recording is enabled. They include monotonic run
elapsed time, admission wait, source-read duration, state, and run/source ids. Read duration includes
downstream reader queueing and rendering; it is not a pure network timer. The first-source event
marks the first readable document, not the model's acceptance of that evidence. These notes add no
persisted content ledger or background model call; trace failures cannot interrupt retrieval.

Separate from telemetry, Tools → "Turn trace" in the title bar opens a live view of everything the main
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
base64 payload just to discard it. Serialization still runs synchronously, but traversal is capped
at 2,000 values and 12 levels before JSON encoding, in addition to the detail character cap.

The performance summary (`renderer/trace/trace-performance.ts`) derives model passes, cache/token
usage, context, tool time, and visible chat IPC efficiency from the available entries. The main
process coalesces adjacent text/output deltas for up to 8 ms immediately before IPC, with all other
events acting as ordering barriers, and records one compact `chat.ipc` note per fully observed turn.
Codex and Claude raw messages supply
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
