# Investigation and experimentation platform

Status: network identity and durable artifact slices implemented; installed capture qualification
and the remaining platform phases are incomplete, 2026-09-13. Supersedes the scope
and sequencing of [the recon integration review](recon-buildout.md); that review retains
the Continuum baseline. User direction: materially exceed recon tooling and make ClosedAI
unusually capable across any task that benefits from observation, analysis or experiments.

## Product objective

Give every supported model a programmable environment for inspecting systems, preserving
what it learns, testing explanations, making changes, and proving outcomes. Recon is one
application. Debugging, performance work, migrations, API integration, QA, accessibility,
data extraction, research, incident analysis and workflow automation use the same substrate.

Success is a model answering “why did this happen?”, locating the relevant implementation,
testing a change, and returning reproducible evidence with less repeated exploration and
less context usage than the current app. More tool names or a larger prompt are not success.

## Capability posture

- Preserve arbitrary CDP, page JavaScript, native file/shell tools and custom analysis code.
  Convenience operations must not become a whitelist or mandatory workflow.
- Expose capabilities to every applicable task and provider. Do not require a recon mode,
  special prompt phrase, permanent sidebar, or fixed autonomous planning engine.
- Let models choose passive observation, diagnostic instrumentation or active experiments.
  Describe effects precisely; an expensive tool need not mean repeated permission prompts.
- Retain large raw results outside context. Page, project, stream, diff, or export them rather
  than clipping away the information an expert needs. Resource admission and backpressure
  protect the app; budgets should be explicit, adjustable and resumable.
- Support authenticated live work when the task calls for it, plus disposable laboratories
  for repeatable substitutions and fault injection. These are different execution surfaces.
- Keep user authority separate from retrieved data. Page text cannot grant privileges or
  authorize vault access. An archive reference is evidence, not a new instruction.
- Make the entire supported protocol available with runtime discovery. “Full” does not imply
  access to unavailable server internals, universal deterministic replay, or unmeasured coverage.

## Seven connected capabilities

| Capability | What models can do | General payoff |
|---|---|---|
| Live observatory | Inspect DOM/layout/styles/accessibility, pixels, scripts, execution contexts, frames/workers, requests/streams, storage and browser state | UI diagnosis, extraction, accessibility, recon |
| Durable evidence | Retain exact artifacts, snapshots, observations and derivations with hashes, build/environment identity and source links | Continue after restart/model switch; audit findings without rediscovery |
| Application graph | Query relationships among source, routes, components, state, network contracts, executions, claims and unknowns | Locate causes, map integrations, estimate migration impact |
| Experiment laboratory | Fork disposable environments, replace responses, inject failures, compare variants, rerun assertions | Debugging, performance, resilience and behavior validation |
| Programmable analysis | Run model-authored parsers, reducers and analyzers near stored data; save validated reusable analyzers | New problem classes without waiting for a new host tool |
| Persistent execution | Checkpoint collections and experiments; expose progress, partial results, cancellation and resume | Long tasks survive context rotation and interruption |
| Proof and delivery | Export evidence, traces, schemas and specifications; compare implementations against independent checks | Reproducible fixes, reconstruction, QA and useful handoffs |

The distinctive feature is the connection between these capabilities: an answer can point
from a visible value to an observed response, an executed code range, an experiment and a
verified fix. Temporal proximity alone never creates a causal edge.

## Architecture decisions

### A shared evidence substrate

Introduce dependency-free contracts under `src/shared/` and worker-backed services under
`src/main/investigations/`. The evidence vocabulary must be source-neutral: browser captures,
files, command/test results, datasets and imported traces all participate. Prefer a small set
of envelopes plus typed payloads rather than one table/tool per task type.

An observation identifies its collector/version, source, target/session/document, interval,
environment/build, collection mode, status and exact artifact references. An artifact carries
content hash, byte length, media type, encoding, access scope and transformations. Claims link
to supporting or contradicting observations; hypotheses and model judgments stay separate from
host-observed facts. Corrections append relationships rather than rewriting original evidence.

Use scoped SQLite metadata and content-addressed blobs with crash-safe publication, integrity
checks, operation receipts and deletion. Retention is explicit at collection/run creation,
not reconfirmed per artifact. Keep immutable originals when selected and derived views labeled.
Do not automatically archive vault values or turn traces containing secrets.

Expose compact manifests and exact byte/text ranges, JSON projections, indexed queries,
content search and artifact export. Add graph queries and structural diffs over that substrate.
Use existing research/cache code where appropriate, but caches do not become durable archives
by renaming them. Avoid a second provider transcript archive or mandatory workspace file tool.

### Coordination across execution surfaces

Reuse the existing CDP session per WebContents, resource locks, cancellation signals and
batch compensation. Add leased collectors and an explicit commit-admission boundary. DOM
stability and pixel freshness are separately measured; unsupported rendering surfaces remain
usable as unverified evidence rather than silently becoming verified.

Browser access remains application-shared. Durable scopes resolve from host chat/project
identity and survive same-chat model changes. Add explicit investigation sharing between
chats instead of accidentally tying access to provider thread ids. Hiding or parking a pane
does not delete evidence. Lifetime must be distinct from the model turn for authorized runs.

Heavy parsing, indexing, hashing, diffing and analyzer execution run outside the renderer.
Separate a pure analysis worker from a disposable execution process that runs generated code.
Collection, analysis and laboratory sessions share operation/evidence identities, not secrets
or mutable browser state by default.

### Tools and model ergonomics

Extend existing browser/CDP operations for acquisition. Add an investigation namespace only
for durable artifacts, relationships and lifecycle; separate read tools from mutations. Add
experiment/run tools when their lifecycle differs. Provider adapters only translate contracts.

A compact capability discovery response should report supported surfaces, available operations,
active collectors, retention, costs/limits and unsupported features. On-demand method/schema
lookup should make advanced protocol use practical without dumping protocol inventories.

Models can move between semantic operations and raw protocols. Large raw results should return
usable handles; schemas, projections and error remedies should make the next call obvious.
Missing data must say whether it was never collected, evicted, filtered, unsupported, corrupt,
or still pending. Results distinguish passive retrieval from newly executed requests.

### Extensibility beyond the browser

Allow explicit import of local test outputs, profiles, structured logs, OpenTelemetry traces,
API schemas, HARs and datasets. Preserve native file/shell access; import chosen artifacts
without intercepting every file read. Trace/span ids establish cross-service linkage only
when actually present. Add server/database adapters for systems the user can access; browser
observation alone cannot establish a hidden backend implementation.

Reusable analyzers declare input/output schemas, version, dependencies, execution requirements
and fixture checks. Models may write and run new analyzers immediately in the suitable execution
surface; promotion to an app-wide catalog requires regression evidence and explicit provenance.
Imported source is parsed as data until an execution task deliberately selects it.

## Phased implementation with measurable gates

| Phase | Deliverable | Acceptance gate |
|---|---|---|
| 0: Baseline and contracts | Source-neutral evidence/run/collector contracts; fixture tasks; runtime capability inventory | Known outputs and failure modes recorded; distinguish existing features from new work |
| 1: Acquisition and artifacts | Coherent capture; exact CDP traffic identity; large-result retention and projections; durable store with read/export/delete | Exact selected artifacts survive restart; no stale verified pixels or implicit replay in historical reads; crash/corruption/cancellation tests |
| 2: Continuous observability | Leased capture across frames/workers; selected response bodies, streams, DOM/style/accessibility snapshots, source and coverage | Follow a fixture action across surfaces; report loss/overhead; detach/cancel cleanly |
| 3: Analysis and application graph | Source indexing, source maps, imported test/trace evidence, claims/contradictions, graph queries, diffs and custom reducers | Answer fixture implementation questions with exact support; report unresolved cases; invalidate build-dependent conclusions |
| 4: Experimental execution | Disposable labs, controlled network, response substitution, timing/error/environment variants, trace packages and assertions | Reproduce a hypothesis test from a fresh lab; block unintended outbound effects; retain useful failed runs |
| 5: Persistent adaptive work | Host run checkpoints, resumable collection/analysis, exploration frontier and validated analyzer reuse | Resume without repeating committed effects; reuse one new analyzer on a second task; show measured gain |
| 6: Cross-task product qualification | On-demand evidence/experiment UI, exports and backups, provider evaluations, cross-platform qualification | Independent task scores improve over baseline; critical retention/isolation failures absent in declared coverage |

Do not delay all useful features until a final phase. Every increment ships a usable vertical
slice through the existing tools. Acquisition and evidence are dependencies; UI polish and
specialized framework adapters should not hold them hostage. Backup/schema migration and
deletion are production data requirements, not optional end-of-project housekeeping.

### First implementation slices

1. Preserve repeated CDP requests and child-session identity; route exact child body reads.
   Keep resource timing as URL discovery, never guessed request-level evidence.
2. Add durable raw artifacts and bounded retrieval for selected protocol results and explicitly
   imported files. First end-to-end task: retain a large snapshot/source result, query it after
   navigation and restart, then export and delete the test investigation.
3. Add capture interval/document/state contracts and the native hidden-pixel fixture. Select
   the smallest native coordinator change supported by the measured baseline.
4. Add scoped collectors linking action/network/source records, then a model-authored reducer
   that answers a useful debugging question over retained artifacts.

## Benchmark the differentiator

Use a fixed offline corpus before making superiority claims. Run the same tasks with today's
tools and each vertical slice, retaining prompts, fixture versions, outputs and independent
ground truth. Separate host tests from actual model runs. Paid evaluations require task scope
that includes them; no new provider bill is necessary for the initial offline implementation.

| Task | Independent success measure |
|---|---|
| Debug duplicate concurrent API calls | Identify the response and code path responsible for each visible result |
| Diagnose slow interaction | Locate fixture bottleneck and demonstrate measured improvement without behavior regression |
| Understand unfamiliar app | Recover declared routes/contracts/states and label intentionally undiscoverable facts unknown |
| Extract changing structured data | Produce correct records with source/time identity and resume without duplicate output |
| Test a migration | Detect seeded schema/behavior incompatibilities and validate the repair |
| Rebuild an interaction | Pass independent state/error/contract tests and declared visual tolerances |
| Investigate a multi-service failure | Link imported trace spans to the seeded fault, without inventing missing causal links |

Track correctness and unsupported claims, coverage against fixture truth, wall time, model
context volume, retained bytes, redundant operations, successful restart/resume and unintended
effects. Set acceptance thresholds from measured baselines before qualification; do not invent
a maturity score or label the platform state of the art before comparative evidence exists.

## Current implementation record

2026-09-20: observation correctness increment removes the ambiguous session-network body
reader and its implicit replay. Exact historical body reads use CDP request/session ids;
`embedded_browser.network_replay` is a separate explicit mutation that rejects incomplete
upload bodies. Instrumentation no longer wraps eval/Function, reports per-feature patch
status, and disables/restores current-document wrappers and listeners on unhook while
preserving page replacements. Other frame cleanup, coherent capture, continuous collection
and isolated laboratories remain separate work. Earlier dated records below describe their
then-current boundaries.

2026-09-13: first network-identity slice implemented in the existing CDP services. Repeated
URLs retain separate captured records; overlapping root/child request ids are separated;
body reads accept the listed child session; URL timing no longer supplies guessed request
fields; UTF-8 text body byte counts are corrected. Shared model guidance exposes advanced
tools for applicable tasks. Installed runtime verification remains pending.

Verification: `npm run typecheck`, `npm run hygiene` and `npm run map:check` passed. The focused
CDP network, host and tool tests passed 32/32; the session-network routing regression passed
1/1 (33 total), using these commands:

```sh
node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs --test src/main/cdp/cdp-network.test.ts src/main/cdp/browser-cdp-access.test.ts src/main/tools/cdp/cdp.test.ts
node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs --test src/main/browser-network-access.test.ts
```

These are offline tests of identity, routing, output and existing CDP behavior; they do not
establish native Chromium capture freshness or cross-provider model performance.

The network-identity increment did not implement durable artifacts. The subsequent artifact
increment below supplies that substrate. Coherent capture, laboratories, the application
graph and persistent execution remain incomplete. Session-level `embedded_browser.network.body` retains its
legacy URL/method association and replay fallback; use exact CDP body reads for this slice.
Replacing that legacy behavior with explicit replay remains an acquisition follow-up.

### Durable artifact increment

2026-09-13: explicit CDP command retention, local file import, list/read/JSON-pointer projection,
provenance reads, verified no-clobber export and scoped deletion are implemented. The host
resolves stable chat/project authority; the worker keeps SHA-256 content addresses, quotas,
operation reservations/receipts, integrity checks and deletion tombstones. Retention remains
opt-in; no model transcript or vault data is automatically collected.

Storage decision: this slice keeps artifact bytes as SQLite BLOBs in the metadata transaction,
instead of introducing separate filesystem blob publication. This removes a dual-resource
commit boundary. Worker packaging is a separate main-build entry, exercised under bundled
Electron 44.1.1 / Node 24.19.0. The packaged smoke verifies a large artifact, abrupt worker
restart, projection, same-key retry, exact export and deletion in temporary directories.

See [artifact contracts and exact verification commands](investigation-artifacts.md). No active
app profile was used in the tests. All 23 focused tests, typecheck, hygiene, map check and
the packaged Electron worker smoke passed. No active
app restart or installed browser/provider verification was performed. This increment does not
complete Phase 1: coherent capture, source leases, explicit session-network replay separation,
full backup/restore and schema migration remain open. There is no grouping/sharing UI or
chat/workspace deletion cascade in this first artifact substrate.

Next: after loading the native changes, verify installed retained CDP acquisition against a
synthetic page. Continue with capture interval/document/state contracts and the hidden-pixel
fixture; then choose the smallest coordinator change justified by the native baseline.

## Primary references consulted

- [CDP DOMSnapshot](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/): snapshot protocol surface; validate actual bundled-runtime support before use.
- [CDP Debugger](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/): source, breakpoint and execution inspection surface.
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer): action, DOM, network and source evidence in saved traces; reuse compatible tooling rather than rebuilding its viewer.
- [OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/): a standard foundation for importing distributed trace relationships.

These references inform architecture, not a claim that those integrations are installed or
that the proposed combination is uniquely superior to every existing product.
