# Source-guided task execution: implementation plan

Status: implementation started, 2026-09-20. The sections below retain the design proposal;
the implementation record distinguishes delivered changes from pending work.
Priorities: quality first, latency a close second, token usage third. No evaluator,
additional planning agent, persistent learning loop, or expanded conversational memory.
Paid search APIs are eligible wherever they improve evidence quality, freshness, coverage, or speed.
Free access is not a selection requirement. Compare total task cost rather than price per query alone.

## Implementation record

The first delivery implements the shared task/evidence guidance, source-only research requests,
discovery terminology, Brave source boosting/Goggles/date ranges/independent relevance and context
controls, cache/date provenance, bounded candidate admission with reserved reads, and content-free
research timing. A follow-up slice (same date) fixed index-age presentation after a live probe
showed official living docs labeled with a years-old relative age: Brave results now prefer the
ISO index-reported date, carry Brave's `fetched_content_timestamp` as a distinct `content_fetched`
observation, and the shared instructions direct models to treat a technology's official
documentation as primary evidence and boost its canonical domain with `preferred_domains`
(model-supplied, never hardcoded). Focused tests cover these contracts and an isolated Electron fixture verifies
source-tab presentation while research continues. Existing prompt limits are unchanged.

Live scholarly discovery/citation traversal, PDF extraction, older-library retrieval, paid-provider
comparisons, and repeated model task trials remain pending. No performance or task-quality gain is
claimed from the contract tests. The findings table below describes the pre-implementation review.

## Intended behavior

The model should recover the user's intended outcome, respect explicit constraints, investigate
consequential assumptions, and use appropriate current evidence to choose and execute an approach.
It should discover substantially better approaches when there is a concrete reason to look, without
turning every task into research. Search should overlap independent work and end when the decisions
are adequately supported. The application supplies reliable retrieval; the selected model owns
interpretation, synthesis, execution, and the decision that evidence is sufficient.

This plan improves access to information, not website-specific procedures. The existing browser,
memory, checkpoint, and handoff features remain useful and do not need replacement for this work.

## Findings from the current source

| Current behavior | Implication |
| --- | --- |
| `application-instructions.ts` says to pursue the named instrument first and discourages speculative searches when it is effective. | A plausible but mistaken user solution can receive too much initial commitment. Replace this qualification; do not add another competing paragraph. |
| All four provider builders include the shared application instructions. Claude also has an explicit override of its preset's literal-scope behavior. | One shared behavior change can reach all providers, but delivery and native-tool differences require verification. |
| `SearchRouter` maps research intent to Tavily/You/Brave; depth selects more engines and provider-specific search effort. | Research intent does not select scholarly sources or establish evidence quality. |
| `ResearchService` starts immediately and streams discovery into concurrent reads. | Keep the scheduler; a new orchestration service or preliminary model call is unnecessary. |
| `discover()` consumes the source budget as results arrive. Later candidates are discarded after it fills. | A fast broad search can exclude a slower, better source. Follow-up URLs can also be starved. |
| Tavily requests a generated answer for research intent, while research runs discard provider answers. | Disable unused provider synthesis on the research-run path. This removes unnecessary work; its latency benefit must be measured. |
| Research source records contain retrieval time but lack structured publication/version metadata; search age is not carried into collected records. | The model cannot reliably distinguish freshly fetched content from fresh evidence. |
| Query results call duplicate discovery `corroboratedBy`; run results already call it `discoveredBy`. | Normalize this terminology. Multiple indexes returning one URL are not independent confirmation. |
| The library uses alphaXiv discovery, is manually refreshed, stores abstracts, matches locally by words, and filters saved reads by its publication window. | Keep it as optional discovery. It is not live research, a complete literature index, or full-paper evidence. |
| The source reader accepts HTML/text/JSON; PDFs require another browser/tool path. | Scholarly discovery needs a reliable path from metadata to full text. |
| A run completes when queued work settles; extend accepts only running runs. | Transport completion is not task completeness. Follow-up discovery currently starts another run when needed. |
| There are already bounded queues, cancellation, source hashes, output paging, and private investigation archives. | Extend these contracts rather than creating duplicate storage, workers, or an evidence database. |

Primary owners: `src/main/chat-context/application-instructions.ts`, provider instruction builders,
`src/main/tools/search/`, `src/main/research-runtime.ts`, and
`src/shared/web-research.ts`. The inspected checkout was clean before this plan was added.

## 1. Replace the task and sourcing guidance

Rewrite the existing objective/research paragraphs into one concise shared contract:

> Work toward the user's intended result and respect explicit constraints. Treat diagnoses and
> proposed methods as hypotheses when their accuracy affects the outcome. Resolve consequential
> uncertainty using the most direct applicable evidence: local state, authoritative APIs, current
> documentation, original research, or other task-appropriate sources. Start with current evidence;
> follow older work when it remains applicable or supplies necessary foundations. Investigate a
> plausible better approach when it could materially improve the result. Overlap independent
> retrieval and execution; wait before decisions that depend on unresolved findings. Read the
> evidence behind important claims, distinguish uncertainty from fact, and stop researching when
> the task's decisions are supported and further findings are unlikely to change the result.

This is a proposed contract, not additional instructions activated by this document. Refine the
wording against existing prompt budgets rather than appending it verbatim to the current paragraphs.

Keep library access optional. Do not require a library-status call, visible research plan,
fixed number of searches, fixed number of sources, or completed checklist on every task.
Respect a user's explicit requirement to use a particular method; objective recovery is not
permission to change scope, publish, purchase, or override preferences.

State the stopping condition in tool guidance: read the needed sources and cancel unnecessary
remaining work before finishing. Do not wait for every queued document merely to obtain a
`completed` run. Timeouts and budget exhaustion mean an incomplete search, not a verified answer.

Files: shared application instructions; Claude's preset override if wording needs alignment;
`docs/application.md`, `docs/model-context.md`, and tool descriptions. Keep response style in its
existing owner. Reconcile documented prompt-size limits with the executable limits in
`model-efficiency-instructions.test.ts`; do not raise the test limits.

## 2. Improve the existing web research pipeline

### Use provider capabilities, including paid options

ClosedAI already implements Brave, Serper, Tavily, and You.com adapters with credential lookup.
This establishes integration support, not that every account is configured or has a particular plan.
Improve useful existing integrations before adding equivalent vendors. Add a provider when its
coverage, customization, reliability, or latency supplies a measured advantage for a task class.

| Candidate | Concrete capability to assess | Existing integration / next step |
| --- | --- | --- |
| Brave LLM Context | Goggles source boosting/downranking, custom freshness ranges, separate context/relevance controls, extracted page chunks. | Current adapter already uses LLM Context, token/URL limits, threshold modes, source metadata, and coarse freshness. Add supported customization and preserve more evidence structure. |
| Serper | Google discovery and its advertised Scholar/other specialized search surfaces. | Current adapter uses web and news only. Verify the Scholar request/response contract and account access before implementing it. |
| SerpApi | Documented Scholar citation searches, all-version searches, year bounds, date sorting, and payload field selection. | A distinct vendor from Serper. Compare only where these capabilities add value over existing discovery and a scholarly graph API. |
| Tavily / You.com | Existing extraction/search controls, useful coverage, and incremental return timing. | Keep them available; tune against task results instead of treating research/answer intent as a permanent vendor ranking. |

Brave's current documentation supports `goggles` on the existing LLM Context endpoint, including
inline definitions, and custom date ranges. Implement small, inspectable source-ranking presets
for relevant task classes, with caller-selected domains when appropriate. Prefer boosting over hard
exclusion for exploratory work, keep an unfiltered fallback for coverage gaps, and do not let the
presets erase contrary findings or mistake a preferred domain for proof. Include profile/version
and date range in cache keys and result provenance. Preserve explicit user domain restrictions.

Separate discovery breadth, relevance threshold, context amount, freshness, and provider selection.
Today's Brave `deep` setting simultaneously increases breadth/context and relaxes relevance; more
effort should not necessarily mean admitting less relevant material. Keep shared model inputs small
and capability-based; map them to provider-specific parameters inside adapters. Unsupported controls
must be reported or routed to a capable provider, not silently ignored or shown as applied.

Preserve origin URLs and extraction provenance for provider-supplied page chunks. They may answer a
narrow question without a duplicate fetch when the excerpt is sufficient. They do not establish that
the full source was read or that a live page still matches; fetch original/full content when scope,
currency, ambiguity, or important missing context requires it. Distinguish extracted source text
from a provider-generated answer.

Run a bounded comparison on representative tasks using the same queries where meaningful, recording
primary-source discovery, applicable freshness, unique useful coverage, field/filter fidelity,
time to usable evidence, tail latency, failure/rate-limit behavior, and total task cost. Validate
vendor latency claims rather than adopting them as measurements. Use one well-suited provider by
default; add a complementary parallel request when coverage or uncertainty justifies it. A second
provider sharing the same underlying index may improve API behavior without independent coverage.
Cancellation can save local work but must not be assumed to refund a billed request.

Choose paid tiers and API spending limits when integrating, using current pricing and the intended
request volume. Do not block a better paid option merely because a free alternative exists. This plan
does not subscribe to services or authorize unbounded spending. Existing authorized API use remains
available; new purchases/account changes require their normal explicit authorization.

Official capability sources checked on 2026-09-20:

- [Brave LLM Context, including Goggles and freshness](https://api-dashboard.search.brave.com/documentation/services/llm-context)
- [Serper product surfaces](https://serper.dev/)
- [SerpApi Google Scholar API](https://serpapi.com/google-scholar-api)

### Source selection

Preserve `search.query` for individual lookups and `search.run/read` for overlapping work.
Add an optional preference for task-relevant source classes and preferred domains to research
discovery; retain exact include/exclude filters for explicit restrictions. Preferences influence
selection, not permission or factual authority. Community reports remain valid evidence for user
experience questions and weak evidence for technical conclusions without reproduction.

Separate the bounded candidate list from the full-document read budget. Maintain an inexpensive
metadata queue and admit promising candidates to free read slots using explicit target relevance,
source origin, applicable version/date, and redundant-content signals. Begin useful reads as soon
as they are available; do not wait for all search engines to finish or use another model to rank.
Never invent a universal credibility score. Expose the basis of a preference to the calling model.

Known source URLs retain priority. Reserve a small part of the document budget for caller-selected
follow-ups so a late primary source is not silently lost. Report omitted/deferred candidates and
the reason. A selected follow-up can consume a reserved slot or start a new bounded run; do not
silently increase the cap or discard retained evidence. Initial experiment: reserve two slots
when the document budget permits, releasing them when the model explicitly requests more discovery.
This is a trial configuration, not a measured optimum or a universal source quota.

### Freshness and provenance

Extend normalized source metadata with optional published date, updated date, work/version ID,
evidence-period information when supplied, and provenance for every date. Preserve the requested
URL and resolved URL separately. Unknown dates stay unknown; HTTP Last-Modified, index age, and
publication date must not be silently substituted for one another.

Expose cache observation time and whether discovery was freshly requested. `live` remains a cache
bypass, not a promise that the underlying source is up to date. Use short reuse for repeated public
discovery within a task; bypass when a current-state question requires it. Do not disable all caching.

Prefer recent relevant discovery initially, without imposing a global date cutoff. Match installed
software versions even if newer documentation exists. If a recent-only search misses, broaden dates
explicitly. Check later revisions, corrections, or withdrawals when available from the source; absence
of such metadata must not be rendered as a clean bill of health.

### Remove unnecessary work and misleading labels

- Disable provider-generated answer synthesis inside research runs where it is discarded. Preserve
  intentionally requested answers for the standalone lookup path.
- Replace `corroboratedBy` with discovery terminology in the query contract, caching, tests, and docs.
  Refresh saved tool catalogs through the existing provider mechanism; use a transition alias only
  if an identified consumer requires it, not indefinitely.
- Describe depth as discovery breadth/effort. Remove the promise that more providers provide
  corroboration. Independent support requires different underlying evidence.
- Clarify run completion, partial results, deadlines, and cancellation in model-facing output.
- Preserve one live source tab and explicit headless mode. Avoid opening additional tabs merely to
  demonstrate activity or disrupting an active browser operation.

Owners: search types/router/provider adapters, research service/tools/source reader, and
`src/shared/web-research.ts`. Extract candidate admission and metadata normalization into focused
modules; keep scheduling orchestration thin and within repository hygiene limits.

## 3. Add live scholarly discovery and bounded citation traversal

Reuse the existing alphaXiv adapter for on-demand paper discovery, isolated from mutation of the
saved library. Move its reusable transport/parser into a shared research-source module rather than
copying it. Library refresh remains a user-owned operation; task queries never change its topics,
save papers automatically, or bypass the library's saved-data retrieval switch.

Expose live paper jobs as optional inputs to `search.run` alongside existing web queries and URLs:

- Paper discovery: query, optional publication window, bounded result limit.
- Paper relations: a validated DOI/arXiv/provider ID, relation (`references`, `citing`, or `related`),
  bounded limit, and optional date window for subsequent work.

Use explicit paper inputs rather than silently redefining every `intent: research` query as science.
Paper candidates and collected sources return through the existing `search.read` path. Network-only
discovery writes only the existing temporary run cache. Add no separate agent, queueing framework,
or model invocation, and preserve current inputs during migration.

Initial graph-API candidate: Semantic Scholar, compared with the applicable paid Scholar options
above before selecting the first new adapter. Its official API documents graph records,
citations/references, recommendations, batching, and selectable fields. Its documented initial keyed
rate is one request per second, so budget and batch independently of the web engines. Validate
endpoint access, availability, and latency before committing the adapter. Do not assume a key is
already present or provision a paid service as part of implementation. Use existing credential
handling if configuration is needed; missing access produces an explicit capability result and a
working web/alphaXiv fallback without repeated retries.

OpenAlex is another candidate if these options cannot meet coverage/access/latency requirements. Do
not build every candidate initially. Its current API documentation describes a connected scholarly dataset and
public basic access, but this review did not test its production endpoints or compare coverage.

Traversal is one explicitly requested hop at a time, never an automatic recursive crawl. Fetch
metadata first, deduplicate identifiers and versions, and read the few sources that can affect the
decision. Distinguish preprints from published versions where metadata permits. Citation count and
recency help discovery, not truth ranking. New low-citation work must remain discoverable.

Sources checked for this plan:

- [Semantic Scholar API tutorial](https://www.semanticscholar.org/product/api/tutorial)
- [OpenAlex API reference](https://developers.openalex.org/api-reference/works/get-a-single-work)

### Full text is part of this slice

Resolve a discovered paper to accessible publisher/repository HTML or a PDF, preserving work and
version identifiers. Prefer usable HTML; when only a PDF is available, add bounded text extraction
outside the Electron main thread. Select and pin the parser only after checking current maintenance,
licensing, packaging, and extraction quality. The repository currently has no PDF parser dependency.

Retain page markers and explicit extraction/truncation status. Use browser screenshots for claims
depending on charts, tables, or layout. Scanned or inaccessible material is reported as unavailable;
do not claim to have read a paper from its abstract or automatically start expensive OCR on every PDF.
Keep document limits separate from today's small HTML body limit and justify them with fixtures.

## 4. Improve the library narrowly

Keep the manual topics/update/dismissal controls and optional local lookup. Surface existing stale
status clearly in model results; a stale saved index can seed live discovery immediately without a
refresh prerequisite. Add identifier-based handoff from a saved paper into the live research run.

Allow an explicit read/search of older retained papers for references even when outside the current
discovery window. Keep the saved-library default window and dismissal behavior intact; display that
an older item is outside it. Never resurrect dismissed records or pretend evicted papers remain saved.
Use live lookup for missing records. Older foundations should not require broadening every default
library search.

Keep lexical search initially. Add semantic/vector infrastructure only if task trials show misses
that live semantic discovery and better queries do not adequately address. No graph visualization,
new dashboard, scheduled refresh, or local copy of the scholarly corpus is required for this plan.

If source/version details need a UI, extend existing research/source surfaces. Any new control gets
its shared `data-ui` manifest entry and companion styles in the same change.

## Execution and stopping behavior

For a substantial task the model should identify the outcome, nonnegotiable constraints, and the
uncertainties that could change its approach. These can remain ordinary task reasoning; no mandatory
structured plan tool, persistent task schema, or additional model pass is needed.

Use direct/local evidence when sufficient. For open questions, start focused source discovery and
continue work independent of its answer. Before committing to a dependent choice, read the relevant
evidence. Follow citations, revisions, repositories, or datasets when they resolve an actual gap.
Keep a compact connection between major decisions and their supporting sources in the task context;
do not automatically persist a new memory or knowledge graph.

Research is sufficient when the important decisions have applicable support, material contradictions
are resolved or explicitly disclosed, and another plausible finding is unlikely to change the next
action. Task completion additionally requires the requested deliverable and its acceptance checks.
The model may finish with a documented limitation when evidence is inaccessible; it must not describe
an unsupported assumption as settled. User-requested exhaustive surveys remain a different scope.

## Performance and quality validation

No evaluator runs in the product. Validate during development with fixed task fixtures, observable
acceptance checks, and inspection of ambiguous outcomes. No LLM judge or hidden background reviewer.

Use the same model/effort for before/after comparisons, fresh sessions, warm and cold cache cases,
and several repetitions for variable tasks. Verify shared behavior on Codex, Claude, Antigravity,
and Cursor where available. Record unavailable lanes rather than claiming parity. Native provider
tools may bypass ClosedAI's source pipeline; shared guidance can route models but cannot guarantee
every tool choice. Validate actual calls, not just prompt-string inclusion.

Representative fixtures:

| Task | Required observation |
| --- | --- |
| Simple local edit or rewrite | Completes without unnecessary external requests or a research preflight. |
| Wrong diagnosis with a clear desired outcome | Checks decisive local evidence and fixes the actual cause within scope. |
| Explicit method constraint | Honors the constraint instead of silently substituting a preferred method. |
| Long prompt with drifting suggestions | Preserves current requirements and resolves only consequential ambiguity. |
| Current API change with an outdated popular guide | Uses applicable official/versioned evidence and passes an integration check. |
| Recent paper depending on an older method | Finds the current work, follows the relevant foundation, and reads full text. |
| User-experience question | Uses firsthand reports appropriately without treating them as technical proof. |
| Fast irrelevant results, slow primary source | Candidate admission preserves access to the consequential source. |
| Stale/empty/disabled library | Does not block appropriate live discovery or leak disabled saved content. |
| Paywall, scanned PDF, rate limit, conflicting dates | Reports the limitation accurately and takes a bounded useful fallback. |
| Adequate answer while unrelated sources remain pending | Uses retained evidence, cancels unnecessary work, and finishes. |

Measure task correctness and user corrections first; median/tail completion latency and first useful
evidence second; total/cached tokens, provider requests, and API cost third. First commentary time is
not a substitute for task latency. Do not infer task success from HTTP success or tool-call counts.
Use Pareto comparisons: reject slower changes without a meaningful quality benefit, prefer faster
equally correct approaches, and accept some latency when it prevents a material error. Set numerical
regression thresholds after baseline measurements; none are established by this planning review.

Add compact research timing events to the existing bounded Turn Trace: discovery start, first usable
source, source-read duration, queue delay, and cancellation. Keep existing aggregate-only persisted
telemetry; no new permanent transcript ledger. The development fixture runner may export results
explicitly. Missing provider usage/trace data remains marked unknown.

## Delivery order and checks

1. **Guidance and waste removal:** shared contract, terminology, unused synthesis removal, and
   clarification of early cancellation. Ship independently; it adds no runtime model call.
2. **Evidence metadata and admission:** structured freshness, candidate queue, reserved follow-up
   access, Brave customization, and focused provider comparison/timing. Preserve current concurrency
   limits until measurements justify change.
3. **Paper path:** extract alphaXiv reuse, add on-demand discovery and one graph adapter, full-text
   resolution/extraction, and saved-paper handoff. Public source adapters are separately disableable.
4. **Validation and refinement:** complete provider task trials, tune admission/cache settings, and
   add only the minimal UI or local-library retrieval changes that the evidence supports.

Each slice updates the relevant current guides and model-facing tool descriptions. Regenerate the
workspace index when files or IPC ownership change. Follow the existing modular architecture; shared
contracts remain dependency-free and new main-process code belongs to its existing feature domain.

Run `npm run typecheck`, `npm run hygiene`, and only tests exercising that slice. Existing relevant
tests include `model-efficiency-instructions.test.ts`, adapter instruction tests, search/router tests,
`research/service.test.ts`, `research/source-reader.test.ts`, library provider/service tests, and
`peer-research-lifecycle.test.ts`. Add meaningful cases beside new normalization/admission/adapters.
Use isolated Electron fixtures for PDF workers, cancellation, library UI changes, and source-tab
behavior. Use live API smoke checks separately from deterministic tests. No full suite/check gate
for routine slices unless explicitly requested or preparing a release.

Refresh provider sessions/tool catalogs before behavior trials using the existing app mechanisms;
do not judge new guidance through an old saved catalog. Preserve the previous configuration for
rollback of each slice. Do not restart the user's running app merely to save this plan.

## What this plan intentionally does not build

No evaluator, mandatory search per turn, mandatory library lookup, automatic skill authoring,
additional long-term memory, self-modifying instructions, recursive citation crawler, blanket
source credibility score, or repeated after-task reflection. These do not address the identified
source-access and task-judgment gaps and would add maintenance or latency without demonstrated value.

## Planning verification and remaining uncertainty

This is a source-level design, not proof of behavioral improvement. Current code and guides were
inspected; official API documentation was read. Production scholarly endpoint availability,
account access, comparative coverage, PDF parser choice, and end-to-end latency remain implementation
checks. Search routing/admission and unused-synthesis findings were visible in the reviewed code;
their prevalence and measured impact are not established. See the implementation record above
for changes made since that review.
