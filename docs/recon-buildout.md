# Recon integration review and buildout

The [investigation platform plan](investigation-platform.md) supersedes this document's
proposed scope and sequencing following the user's broader product direction. This review
retains the Continuum baseline and initial integration findings.

Reviewed 2026-09-13 against local Continuum and ClosedAI source. This is a proposed
ClosedAI implementation plan, not a claim that recon archives are installed. No live
application, provider, or browser qualification was performed for this review.

## Recommendation

Build investigation and reconstruction capabilities into ClosedAI's existing browser
and provider-neutral tools. Adapt Continuum's evidence contracts, capture coordinator,
storage algorithms, and regression fixtures. Preserve ClosedAI's browser, CDP connection,
tool registry, research runtime, and chat identity rather than transplanting Continuum's
application shell or dispatcher.

The first increment is trustworthy acquisition: qualified screenshot freshness and exact
network-response provenance. Durable archives follow; source analysis then makes the
feature useful for implementation questions. Keep investigations accessible through chat
tools initially, with an on-demand evidence view later.

## Continuum's actual progress

The canonical source is
[the Continuum roadmap](../../continuum-desktop/docs/PRIORITY-expert-investigation-roadmap.md).
Its recorded test outcomes are historical evidence, not tests rerun in this review.

| Area | Current source and recorded status |
|---|---|
| Phase 0 | Contracts, implementation map, fixture specification complete |
| Phase 1A | Coordinated DOM/pixel capture implemented; recorded 10 unit tests and 40 native outcomes; subsequent installed foreground/background check recorded |
| Phase 1B | SQLite worker and scoped content-addressed blobs implemented; recorded 17 store tests including crash/cancellation boundaries |
| Phase 1C | Create/open/capture/read/query/delete, retention policy, commit checks and deletion lifecycle implemented; recorded 17 archive tests; installed restart verification pending |
| Remaining Phase 1 | Export, backup/restore, general migration, provenance-linked claims/contradictions, live network-filter verification remain open |
| Phases 2–7 | Coordinated instrumentation, application analysis, isolated experiments, reconstruction, adaptive exploration, and product qualification remain planned |

The standalone `scripts/site-recon.mjs` already collects bounded anonymous same-origin
sources with hashes and resume validation. `scripts/site-recon-index.mjs` statically parses
JavaScript using Babel, finding selected imports, calls, routes, and fields. It includes
site-specific wrapper patterns; it is not general program analysis or an integrated service.
Its existence does not complete Phase 3.

Continuum's next recorded gate is its installed Phase 1C check. Continue that check when
validating Continuum itself; ClosedAI integration can proceed independently, but cannot
inherit a claim of installed archive qualification from the offline results.

## Reuse and integration findings

| Concern | ClosedAI evidence | Integration decision |
|---|---|---|
| Browser capture | `src/main/ui-capture-access.ts` leases rendering, waits for readiness and frames, then calls `capturePage` | Extend acquisition with before/after document and state samples, explicit freshness status, and cancellation; current readiness is not proof of pixel coherence |
| Screenshot retention | `src/main/tools/capture/screenshot-store.ts` keeps bounded in-memory display images | Keep presentation cache; add durable evidence storage separately |
| Network evidence | `src/main/browser-network-access.ts` matches CDP responses by URL/method and otherwise replays the request | Add exact response correlation and a captured-only read path; never archive a replay as the original response |
| Instrumentation | `src/main/cdp/` provides sessions, hooks, profile/network operations and emulation | Extend these services; do not create a competing debugger connection |
| Cleanup | `src/main/tools/resource-locks.ts` and `src/main/tools/batch/compensation.ts` provide coordination and unwind behavior | Reuse cancellation/cleanup; add capture leases that survive until archive commit admission |
| Research | `src/main/tools/search/research/` and `src/main/research-runtime.ts` provide source reading and bounded research runs | Reuse collection/presentation infrastructure where semantics match; research cache is not an immutable archive |
| Tools | `src/main/tools/tool.ts` carries caller pane, thread, turn and AbortSignal | Resolve durable authority from host chat records, never caller-provided workspace/chat fields |
| Browser identity | Browser is application-shared; pane ids are stable chat ids | Separate browser access from private archive access; do not copy Continuum's owned-tab assumptions |

Two acquisition issues deserve explicit regression coverage. Repeated identical URL/method
requests can be confused by the current CDP lookup; this is a source-visible ambiguity,
not a reproduced wrong-body incident. A body read can also issue the recorded request
again, including its method and post data. Recon must make a new request an explicit
operation and label its evidence accordingly.

Continuum's stale-hidden-image finding is not proof of a ClosedAI bug. ClosedAI already
leases rendering and settles frames, but its capture receipt does not establish that DOM
and pixels describe the same measured interval. Reproduce the fixture here before choosing
the native capture mechanism or claiming a fix.

## ClosedAI phases and acceptance gates

### A — Acquisition contract and coherent capture

- Define versioned evidence types under `src/shared/`: artifact hash, source identity,
  document/frame identity, capture interval, environment, transformations, provenance,
  collection mode, partial/error status and explicit unknowns.
- Add a focused coordinator under `src/main/` used by the existing capture host. Detect
  navigation, closure, document replacement and relevant state changes. Preserve focus.
- Extend network acquisition with exact request identity and captured-only body reads.
  Keep replay/fresh fetch separate from historical evidence retrieval.
- Reuse Continuum's synthetic hidden-state fixture and cancellation/race cases, adapted
  to ClosedAI's rendering leases and shared browser.

Gate: foreground/background captures are current or explicitly unverified; no stale
verified success, no focus theft, duplicate-URL responses remain distinguishable, and
captured-only reads never issue a request. Native pixel claims require Electron evidence.

### B — Durable investigation vertical slice

- Implement a worker-backed store under `src/main/investigations/`, with SQLite metadata,
  immutable scoped blobs, quotas, hashes, idempotency, recovery and bounded projections.
- Adapt Continuum's algorithms and tests into cohesive TypeScript modules; its database
  implementation exceeds ClosedAI's 675-line implementation limit and cannot be copied whole.
- Add provider-neutral investigation tools, separating reads from mutating operations.
  Start with create/open/capture/read/query/delete. Reuse existing capture image formatting.
- Default to metadata retention. Require explicit source/content selection for DOM, pixels
  or bodies. Preserve transformation metadata; visible text and pixels can contain secrets.
- Resolve project/chat identity from the caller's ChatRecord. Model switches and same-chat
  session rotation retain access. New chats require an explicit sharing/import design.
- Integrate shutdown and deletion. Hiding, parking, detaching, or switching projects must
  not delete archives. Reconcile against retained chat records, not attached panes.
- Hold source validity through commit admission; retry uncertain writes using the same
  scoped operation key without recapturing a changed page.

Gate: selected evidence survives restart with intact hashes and provenance; unauthorized
cross-chat reads fail; deletion, cancellation, corruption, quotas and process crashes have
focused tests. Qualify installed tools separately from storage mocks. Verify worker packaging
and bundled Electron SQLite support before committing to the storage adapter.

### C — Useful source recon and application queries

- Extract the collector/indexer into reusable host services with progress, cancellation,
  explicit bounds, resumable durable artifacts and no execution of downloaded code.
- Declare the parser dependency directly if adopting Babel; avoid relying on a transitive
  development dependency in a packaged runtime.
- Add module/source-map relationships and evidence-linked routes, contracts and storage
  findings. Keep site-specific heuristics as tested adapters and report unresolved expressions.
- Persist claims and contradictions. Distinguish shipped strings, reachable code, executed
  branches, observed requests and confirmed backend outcomes.
- Add versioned export and consistent backup/restore before treating archives as portable.

Gate: a known application fixture yields correct linked findings, changed bundles invalidate
affected conclusions, exports round-trip, and unsupported dynamic cases remain visible.

### D — Deeper runtime evidence and isolated experiments

Extend existing CDP target/session handling for frame/worker provenance, coverage, selected
bodies and DOM/style snapshots. Measure dropped events and instrumentation overhead.
Create disposable laboratory sessions with outbound controls and explicit identity policy
before offering response substitutions or replay experiments. Normal shared-browser tabs
and copied cookies are not isolation. Reuse existing emulation/rules behind this boundary.

Gate: a controlled one-variable experiment reproduces from a fresh lab; unmatched requests,
redirects, workers, downloads and cancellation cannot escape the laboratory policy.

### E — Reconstruction and product qualification

Generate evidence-linked specifications, fixtures and implementation tasks. Compare a rebuilt
fixture against independent behavior/contract checks and measured visual differences. Add an
on-demand evidence/claims view with manifest-backed controls. Only then expand to adaptive
exploration, resumable analyzer execution and measured cross-provider qualification.

Gate: reproducible discrepancy reports and declared coverage; no universal reconstruction or
hidden-backend equivalence claim. Keep unknowns visible and benchmark quality, not tool counts.

## Verification and continuation

This review adds a plan only; application behavior and model instructions are unchanged.
For implementation, update the current application/tools/model-context guides and the shared
model-facing descriptions when capabilities actually land. Regenerate the map for new files.
Use typecheck, hygiene and the focused adjacent tests required by AGENTS.md; add proportionate
native fixture verification for capture changes. Do not substitute mocks for compositor tests.

Next concrete increment: Phase A's evidence contract, captured-only network path and synthetic
capture baseline, followed by the smallest coordinator change justified by that baseline.
