# Parallel web research and live browsing

Status: implementation proposal, 2026-09-04. Based on source inspection of ClosedAI,
`/home/dp/Desktop/codeapp`, and `/home/dp/Desktop/appv1codeapp`. No runtime benchmarks or
live UX tests were performed. Numbers proposed below are starting budgets, not measurements.
This document does not change the current application or model-tool contract.

## Recommendation

Extend ClosedAI's existing search router with an app-owned research run. A run concurrently
discovers sources, reads source bodies, and drives an optional live browser target. It publishes
results incrementally to both the model and the UI. Independent work starts immediately;
dependent work starts when its own inputs arrive, without waiting for the entire search stage.

Keep three execution lanes: search API requests, concurrent HTTP source readers, and bounded
Chromium targets for pages requiring JavaScript or interaction. A Chromium target can be hidden
or presented in the shared browser. Visibility must be independent of execution ownership.
One visible research page must not serialize the rest of the run.

## What the reference apps actually implement

| Checkout | Useful implementation | Limitation to avoid carrying forward |
| --- | --- | --- |
| codeapp | Brave search/context and `harvest` connect discovery to concurrent source collection. Large bodies stay in files; the model receives a manifest and previews. | Harvest waits for search, then joins the collection before returning. It is a useful collector, not an incremental research run. |
| codeapp | Hidden `AgentBrowserPool` workers have independent BrowserService instances, tabs, CDP state, and schedulers. `browser_workers` executes independent flows concurrently with sequential steps inside each flow. | This pool has no worker ceiling. Fleet results return after every flow finishes. It does not itself provide progressive model results. |
| appv1codeapp | `web_search` routes to Brave, Serper, Tavily, Jina, and You. Brave adds image, video, news, suggestion, and spellcheck actions. | The unified tool dispatches to one engine per call. It does not itself fan out a query across engines. Its registry still uses the `brave-search` concurrency key, including a write lock for harvest. |
| appv1codeapp | Worker acquisition has an eight-worker ceiling and idle CPU throttling. | The ceiling is per pool; fleet pools are keyed by BrowserService. Nested callers can create additional pools. A process-wide budget is still needed. Idle unthrottling is dispatched asynchronously, so the comment is stronger than the awaited guarantee. |
| Both references | Per-tab read/write locks, explicit tab leases, scoped scheduler keys, and cleanup in flow `finally` blocks. | Session identity remains shared. Independent tabs do not isolate account changes, shared storage, or origin rate limits. |

The inspected harvest, batch-fetch, fleet-service, operation-lock, and session-sync files are
byte-identical between the references. Worker pools and search surfaces differ.

Reference sources:

- [Brave tool and context spill](/home/dp/Desktop/codeapp/src/main/brave-search-tool.ts)
- [Search-to-collection harvest](/home/dp/Desktop/codeapp/src/main/brave-search-harvest.ts)
- [Concurrent collector](/home/dp/Desktop/codeapp/src/main/browser-batch-fetch.ts)
- [Original worker pool](/home/dp/Desktop/codeapp/src/main/agent-browser-pool.ts)
- [Later worker pool](/home/dp/Desktop/appv1codeapp/src/main/agent-browser-pool.ts)
- [Concurrent browser flows](/home/dp/Desktop/appv1codeapp/src/main/browser-fleet-service.ts)
- [Unified search dispatcher](/home/dp/Desktop/appv1codeapp/src/main/web-search-tool.ts)
- [Scheduling declarations](/home/dp/Desktop/appv1codeapp/src/main/codex-tool-registry.ts)
- [Target ownership](/home/dp/Desktop/codeapp/src/main/browser-tab-leases.ts)
- [Per-tab operation lock](/home/dp/Desktop/codeapp/src/main/browser-operation-lock.ts)

The collector's comments call it streaming, but the implementation reads each complete body
with `arrayBuffer()` before writing. Preserve atomic files and manifests; implement actual
bounded streaming for large responses. Its pacing is global to one batch, its breaker is shared
across origins in that batch, and retries do not reacquire the start gate. Replace those with
process-wide provider/account and origin/session budgets that include retry attempts.

## ClosedAI already has a better search foundation

[SearchRouter](/home/dp/Desktop/closedai/src/main/tools/search/router.ts) calls selected providers
with `Promise.allSettled`: balanced selects two and deep three. Results are interleaved and
deduplicated, with partial provider failures and a ten-minute cache. Preserve this foundation.

The missing behavior is around that concurrency:

- `search.query` accepts one query and returns only after all selected providers settle.
  Provider calls share the tool's 45-second deadline. Useful fast results can therefore remain
  unavailable behind a slow provider, or be lost to the outer tool timeout.
- `depth` primarily selects providers; it does not schedule a multi-query investigation or
  read a set of source documents. Provider-generated answers are also mixed into the route.
- Result normalization retains at most 2,000 snippet characters per item. There is no retained
  research evidence store behind this search result contract.
- `corroboratedBy` means the same URL appeared in multiple providers. It is discovery overlap,
  not independent factual corroboration. Preserve compatibility but stop promising the latter.
- `embedded_browser.page.navigate` opens an active new tab or targets an existing tab. Ordinary
  tabs use background throttling and start with a minimal hidden surface; they are not a
  dedicated background execution pool.
- Registry locking covers selected mutations/captures, but not every read, target operation,
  human input, or provider-native tool. A parallel batch only schedules the calls in that batch.
  It does not provide a complete run-wide ownership contract.
- `live: true` currently means bypass the search cache. It must not be repurposed to mean
  visible browser operation; use a separate `presentation` option.

Current source owners:
[search schema](/home/dp/Desktop/closedai/src/main/tools/search/index.ts),
[normalization](/home/dp/Desktop/closedai/src/main/tools/search/provider-utils.ts),
[browser access](/home/dp/Desktop/closedai/src/main/browser-page-access.ts),
[tab lifecycle](/home/dp/Desktop/closedai/src/main/browser-tab.ts),
[locks](/home/dp/Desktop/closedai/src/main/tools/resource-locks.ts), and
[registry deadlines](/home/dp/Desktop/closedai/src/main/tools/registry.ts).

## Execution and ownership

The Electron main process owns the run scheduler, provider clients, Chromium sessions, target
leases, and evidence index. Put heavy extraction or parsing in a worker/utility process when
needed so page processing does not stall Electron main. Renderer components subscribe through
shared contracts and preload; they never drive the research engine themselves.

A run is scoped to workspace, pane, provider thread, and invocation. Worker targets are scoped
to the run and use stable explicit ids. Reading or presenting a target does not silently adopt
another pane's tab. Avoid an implicit active-tab target in background work.

Execution proceeds as follows:

1. The model supplies distinct research questions and any known URLs. The engine starts the
   independent query/provider requests immediately. It can also start a known live page or a
   visible search page immediately when the task calls for browsing.
2. Each provider completion updates the source index. Promising new URLs immediately enter
   the reader queue; a slow sibling provider does not hold them back.
3. Source reading chooses the appropriate representation: direct document/API/HTML fetch,
   then rendered Chromium when content requires it. Known JS-heavy sites can start directly
   in Chromium. Optional hedged reads share a budget and cancel redundant work.
4. Extracted evidence becomes available immediately. The model can follow up on a gap while
   other queries/pages continue. Additional queries enter the same run and budget.
5. The live target continues concurrently. Presenting a hidden source transfers its execution
   lease or pauses that target for the user; it does not stop unrelated workers.
6. Completion or cancellation releases transient workers. User-retained tabs and evidence
   survive under an explicit retention policy; speculative jobs do not continue after a stop.

No additional model or subagent is necessary for independent I/O. The calling model chooses
research questions and assesses evidence; deterministic services handle fetching and scheduling.

Start with configurable process-wide budgets of four provider requests, eight HTTP reads,
two reads per origin/session, and three rendered workers. Allocate fairly across active panes,
reserve capacity for visible interaction, honor provider quotas and Retry-After, and lower
render concurrency under memory pressure. These values need measurement on the target machine.
Queue with cancellation and deadlines instead of telling the model to retry a saturated pool.

Use per-target reader/writer scheduling and a short presentation lock for foreground changes.
Readers must observe a stable navigation generation; mutations take exclusive ownership.
Resolve explicit targets once, and reject stale generations after navigation or takeover.
Unknown JavaScript/CDP operations are exclusive. Session-changing actions need a session-level
barrier; a hidden worker sharing the login must not race a live account switch.

Public research should use an unauthenticated research session by default. Tasks requiring the
user's account explicitly select the existing browser session. Shared Chromium partition state
does not reproduce a page's sessionStorage, JS memory, or origin-bound request behavior; keep
in-page fetch for those cases. Never forward authenticated source bodies to external search or
extraction providers merely because they failed local extraction.

## Model interface and incremental delivery

Keep `search.query` as the small synchronous lookup. Add a run-oriented surface in the same
namespace with separate lifecycle and observation tools:

| Proposed tool | Purpose |
| --- | --- |
| `search.run` with `start`, `extend`, `cancel` | Start bounded multi-query/source work, add follow-ups, or cancel owned work. Return run id and initial snapshot promptly. |
| `search.read` with `status`, `results`, `source`, `wait` | Read compact progress, cursor-based deltas, or selected source excerpts. `wait` returns on meaningful change or a bounded timeout. |
| Existing browser page/CDP tools | Operate on explicit live or hidden targets through the same registry and target resolver. |
| `embedded_browser.targets` lifecycle tool | Allocate/release execution targets and present an owned target; separate from read-only target inventory. |

Illustrative start input: `queries: [{query, intent}], urls: [], presentation: "live",
session: "public", max_sources: 12, deadline_ms: 45000`. Exact schema remains to be implemented.
`presentation: "background"` suppresses browser presentation; neither mode changes cache freshness.

Every run returns `run_id`, state, cursor, completed/pending counts, provider errors, and bounded
source records. Results identify discovery provider, retrieval method/time, document hash,
publication date when known, evidence level, and any incomplete extraction. Snippets, retrieved
documents, and vendor-generated answers are distinct evidence levels. Citations point to actual
retrieved excerpts; multiple indexes listing one document count as one source.

Persist source content and manifests outside tool-result text; retrieve by source id, section,
literal query, fields, and character budget. Keep routine payloads comfortably below the existing
24,000-character registry ceiling, with a total budget across the response, not just per source.
Cache raw discovery and extracted documents separately; key authenticated data by session scope.
Coalesce identical in-flight reads with subscriber-aware cancellation. A failed provider must not
be silently frozen into a healthy-looking ten-minute cache entry.

Do not assume a progress event reaches every provider's reasoning context. Renderer events show
live progress, while all model adapters can use `search.read.wait` and cursor deltas. Codex can
compose calls in exec; other providers can use the shared tools/batches. A single model call to
start a run must fan out internally even if that provider emits only one tool per pass.

Run cancellation is independent of an individual status-call timeout. Wire user Stop, pane
closure, thread replacement, project switch, and app shutdown to owned run cancellation. On
restart, unfinished runs become interrupted; they do not silently restart browsing or paid API
requests. Detached continuation needs its own explicit product contract if added later.

## Live experience

Show a compact research activity item with real counts and a source list: searching, reading,
ready, blocked, failed. Results appear as evidence lands. Clicking a source opens the retained
excerpt or its actual page, with a clear indication if the page has since changed.

The shared browser displays one useful target when live browsing is requested. Offer “Follow”,
“Take over”, and “Keep tab”. Following changes the presented page only at meaningful transitions;
new source arrivals do not flicker through the tab strip. User navigation disables automatic
following. Taking over revokes pending model mutations for that target while other research
continues. Returning control requires a fresh page inspection and navigation generation.

Prefer presenting the existing WebContentsView for a worker source to preserve page state.
Electron exposes native view add/remove and session-level fetch primitives, but transferring
ClosedAI's target safely also requires moving host listeners, bounds, focus, capture routing,
and lifetime ownership. Validate that transfer on Linux before promising seamless handoff.
If transfer fails, explicitly offer reopening the URL; do not pretend it is the identical page.
See [Electron View](https://www.electronjs.org/docs/latest/api/view) and
[Electron Session.fetch](https://www.electronjs.org/docs/latest/api/session#sesfetchinput-init).

Search activity and target controls need shared types, narrow IPC, component/style pairs, and
manifest `data-ui` ids. Keep worker scheduling details out of the normal user flow.

## Delivery slices and proof

1. Extend `src/main/tools/search/` with incremental provider callbacks, multi-query run lifecycle,
   bounded source storage, per-provider deadlines, and global request budgets. Keep existing
   `search.query` compatibility. Add the HTTP reader adapter over an explicit Electron session.
2. Add a focused browser worker/target feature around the existing BrowserTab/CDP primitives.
   Establish target ownership, cancellable scheduling, global worker capacity, cleanup, and
   presentation transfer. Avoid copying the references' entire BrowserService and tool catalog.
3. Connect live research events and user takeover through shared/preload contracts and focused
   renderer components. Update current guides and model instructions only as features ship.
4. Validate the complete path using deterministic gates and a live Electron fixture. The first
   release must include overlapping search, source reading, and live presentation, not stop at
   adding another search wrapper.

Acceptance evidence should show:

- Two query/provider operations start before either resolves; one source reader starts before
  the slowest provider returns; partial evidence is readable while the run remains active.
- Live page navigation and a background reader overlap. Independent worker pages overlap;
  same-target mutation/read conflicts and takeover are deterministic.
- A slow/failed provider cannot hide good results. Global and per-origin limits include
  nested runs and retries, with fair admission for another pane.
- Stop aborts requests, drains owned queues, and disposes workers. Late results cannot mutate
  a new thread or target generation. User-retained tabs are not destroyed with the worker pool.
- Authenticated page state stays scoped, evidence survives output truncation, duplicate URLs
  do not become independent corroboration, and citations resolve to retained source excerpts.
- Measure time to first usable evidence, time to sufficient evidence, critical-path duration,
  provider failures/cost, queue waits, renderer memory, and UI responsiveness. Compare the same
  fixture against a serial execution. Do not use raw tool-call count as the performance result.

For implementation changes run typecheck and only affected test files; run hygiene for changed
structure and regenerate the repository map. No baseline/full-suite run is required for this
proposal. Native hidden rendering, handoff, and responsiveness require later live verification.
