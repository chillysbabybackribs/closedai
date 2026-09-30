# Browser efficiency audit — 2026-09-30

Status: shared fixes implemented and locally verified. The original measurements below used the pre-change Electron process. The later **Fresh-chat cross-provider live runs** section records user-authorized runs with the updated text-window and captured-body projection behavior confirmed live. These are single samples, not a controlled before/after speedup claim.

## Scope and measurement

Baseline checkout: `5b87fb0ed07a`. All changes are in shared tools, their tests, generated orientation, and current documentation; no provider adapter changed. Git status was clean initially. File mtimes were checked before edits. The app's automatic git snapshots committed intermediate edits during this task, so a clean final status is not evidence of no changes; compare against that baseline.

Discovery used `peer_chats.list(scope=history,cwd=...)`, `search`, `spine`, and exact `recall`, followed by paginated `read` for open chats. Spine evidence is sampled, not a call census. UI tool labels also do not identify the underlying tool reliably. Native local transcript records supplied pass counts and timestamps where available. No account details, cookies, credentials, or private response bodies are reproduced here.

A **pass** is one model generation, including the final answer. A **call** is an executed tool operation; batch/exec envelopes are reported separately. Historical Cursor replay records do not preserve generation boundaries or all result bodies, so those measurements are explicitly unavailable. Live task passes below are task decision stages, excluding unrelated audit work and the final audit write-up. Times are either timestamp spans or summed measured tool durations, as labeled. Character counts are returned text, not network bytes or token estimates.

## Historical evidence

| Task / chat | Lane | Passes | Calls to answer | Time | Issues and answer assessment |
|---|---|---:|---:|---|---|
| Neon vs Supabase, `42d66046…` | Codex / gpt-6-astra | 5: four tool-producing passes + final | 10 operations: 8 session fetches, native search, native page open; 4 exec envelopes | 42.905 s, task start 08:25:03.160Z → complete 08:25:46.065Z | 113,720 returned exec text chars, including catalog discovery and wrapper text. Pricing was generically truncated once; guessed `/docs/manage/snapshots` returned HTTP 404 with empty text. Known URLs were already grouped in two parallel groups of four. Native pricing read recovered branching evidence. Main comparison claims corroborated; no unsupported “native-only browsing” diagnosis. |
| Same comparison, `3dc691b5…` | Claude / fable-5-1 | 7 unique assistant message ids | 11: 8 session fetches, navigate, tool discovery, evaluate | 54.967 s, user 08:25:06.501Z → final message 08:26:01.468Z | 61,054 tool-result text chars; 2 generic cuts, largest result 14,217 chars. Requested 30k/40k bodies exceeded the 16k envelope. Navigated pricing and hand-wrote a DOM keyword filter to recover plan rows. Final answer explicitly grounded Free branching exclusion in rendered rows. |
| Same comparison, `4432c983…` | Antigravity / gemini-3.8-flash | 9 generation records | 14: 5 query attempts (2 failed), 5 session fetches, 4 native file reads | 29.295 s first tool → last tool; full turn duration unavailable | Missing `intent` caused two retries, followed by schema/output-file reads. Two session outputs show generic truncation; full search result sizes are unavailable in peer evidence. Core storage/compute/branching claims agree with vendor evidence; “caps” overstates recommended connection defaults, and dedicated instance must not imply dedicated CPU. |
| Browser tools suite initial smoke, `3825796c…`, first user turn through `…:t26` | Cursor / composer-2.5 fast | Not recoverable | 33 top-level tool rows; 12 batches; 111 operations after expanding batches | Not recoverable from replay timestamps | Broad smoke testing legitimately used CDP, capture, cookies, rules, query, extract and evaluate. Avoidable retries included replay with an invalid action, stale replay ids, stale refs/context, `PLACEHOLDER` refs, missing verification in input batches, and a refused Google navigation. Final “Pass” rows must be read with its partial/inconclusive sections; no independent proof that every action passed. |

Historical evidence anchors:

- Astra `exec-4e3e8ce1-a545-4911-86f3-2dfe9e8e15d7`: Supabase session response with `_closedai_truncated` and `bodyTruncated:false`. `exec-24483f8b-d000-4ad3-a5b3-41b196864792`: HTTP 404, empty document.
- Claude `toolu_01Qg6DYNBRHiuYi7UsWtx85u`, `toolu_01FJBm6QpET2iuPvEnaqn4vT`: oversized reads; `toolu_01GSycnhULTMdsw4vrrqEx3G`: rendered table extraction.
- Flash `agy-turn-18c1bd3a-7b36-4f88-b1f6-1e98a1804ef7:s2/s3`: exact missing-intent errors; `:s13/s14`: truncated session reads.
- Cursor `replay-0-26`: inspect with result suppressed, followed by a literal `PLACEHOLDER` click ref. `replay-0-19/23/55`: replay attempts. `replay-0-34`: capture. `replay-0-36`: refused search-engine navigation.
- Native records: Astra rollout ending `01a0f16a-caf2-73f1-b411-c35de223b283.jsonl`; Claude project transcript `4dc5f352-833a-4771-9374-482ef3923e4f.jsonl`; Flash conversation database `a7e68053-d4aa-410a-81fa-605c68eb6187.db` has nine `gen_metadata` rows. These reads only extracted task metrics.

**Correction to the earlier Cursor summary:** it called Astra's “Read page” rows provider-native reads. The actual exec arguments call `tools.embedded_browser__session`. It also undercounted that run's fetches and Flash's calls. Tool identity and counts above come from arguments/full task rows, not the prior assistant summary.

No shell curl or search-engine-page scraping was found in the three comparison tasks. Their captures count was zero. Cursor's one capture was part of an explicitly requested tool-suite smoke test, not gratuitous visual reading. Lack of `site.discover` on already-known vendor URLs is not itself an inefficiency. Native search remained useful for discovery and independent corroboration.

## Four live read-only tasks

The app owns the Chromium session, webContents, passive request log, and CDP capture. These probes used those layers directly. No sign-in, form submission, tool-issued POST, or external write was performed. The SPA issued its ordinary page-load API/analytics requests. Its recorder was unhooked after inspection. No capture was needed.

| Task and stopping condition | Task stages / outer calls / operations | Measured tool time | Returned chars | Result |
|---|---:|---:|---:|---|
| Unfamiliar docs: find what htmx `hx-get` does and whether it is inherited | 2 / 2 / 2 | 929 + 241 = 1,170 ms | 3,291 + 1,860 = 5,151 | `site.discover bootstrap` on htmx.org/docs ranked the attribute page; `expand` returned its explanation and “not inherited.” No errors/capture. |
| Public SPA: identify HN Algolia's search endpoint and read captured results | 5 / 5 / 10 | 1,174 + 1,302 + 48 + 409 + 42 = 2,975 ms | 11,952 | New tab → hook/navigate/wait/apis → passive+CDP requests → navigation with capture active → captured body. The map counted each observed request twice and clipped endpoint labels. First CDP list had timing-only rows because capture was enabled late. The body then hit generic truncation. Recorder cleanup is one additional call, excluded here. |
| Structured DOM: extract Supabase pricing rows containing Branch | 1 / 1 / 1 | 1,344 ms | 1,078 | `script.query(selector:tr,text_contains:Branch,max_matches:3,max_text:500)` returned two rows, including “Branching Not included in free”; many unused element properties. Existing tab already loaded, so this isolates extraction cost. |
| Two-page comparison: retrieve Neon plans and Supabase pricing | 1 / 1 / 2 | 1,472 ms | 11,087 | Parallel `tool_batch` succeeded, but both document bodies were cut to 4,000 chars by generic serialization while reporting `bodyTruncated:false`. Sufficient for basic storage/compute, insufficient for the complete branching comparison; this is a failed evidence-completeness benchmark, not a completed full answer. |

These are single samples, not statistically reliable latency rankings. Tool time excludes model thinking and intervening audit work. Internal bootstrap HTTP probes are not counted as model tool calls. The public SPA was selected instead of accessing a private signed-in account.

## Diagnosis and implemented changes

| Observed inefficiency | Root cause | Shared fix / disposition |
|---|---|---|
| Long HTML reads silently lost later evidence while claiming an untruncated body | Handler/result-budget mismatch: a 20k default body and 100k allowed request fed a 16k JSON serializer, which reduced strings to 4k | Session text defaults to 6k, HTML prose, and omitted response headers. A shared text-window helper accounts for JSON escaping/envelope size before serialization and returns honest coverage and continuation metadata. Raw markup and headers remain explicit options. |
| Repeated wide reads or navigation just to find a later passage | Missing text scoping/continuation affordance; old advice said to raise max_chars | Added literal `text_contains` plus `offset`/`nextOffset`. Results expose `matchOffset`, `totalChars`, `returnedChars`, `bodyTruncated`, and transport `sourceTruncated`. GET/HEAD only; each session call refetches, so content may change. JSON is directed to projection. |
| DOM rows needed custom evaluate code or carried bounds, classes and null attributes | Missing DOM result projection | `script.query fields` reuses the existing JSON projection implementation; `fields:["text","href"]` retains matching/count metadata without unused per-element details. |
| Captured SPA JSON was returned as one escaped string and cut; replay would issue a new request | Missing projection in CDP body handler | `browser_cdp.protocol body` adds `json_path`, `fields`, `max_items` before serialization; captured text uses the same bounded windows. It always reads the captured request id, never replays. |
| API counts exceeded the observed channel counts | Real shared bug: distinct and recent views of the same ring were summed | Count each aggregate once, supplement only endpoints absent from distinct, use recent events for timestamps; preserve independent frame counts. Tests cover overlap and recent-only rows. |
| A capped recorder detail looked like a complete endpoint URL | Result shape omitted uncertainty | `urlMayBeTruncated` conservatively flags 200-character labels and directs the caller to full network request URLs. Hints distinguish captured evidence from a fresh fetch. |
| Late CDP capture forced another navigation | Missing emphasis on acquisition order | Shared body description, guide and docs now say to enable protocol requests before navigation when captured bodies will matter. Passive network metadata cannot retroactively produce response bodies. |
| Placeholder refs, stale ids, wrong batch arguments and verification omissions in smoke | Misleading expectation of batch substitution; some genuine caller errors already guarded | Batch description states arguments are literal and refs require an earlier inspection result; existing validation/ownership/compensation guards remain. No provider-specific batch instruction was added. |
| Known independent URL reads consumed serial tool steps on some lanes | Routing/default affordance gap | Guide describes parallel batches for independent known URLs and direct session fetch for known docs; bootstrap is for unfamiliar origin discovery, not a compulsory extra stage. Astra already batched correctly. |
| Guessed snapshot URL returned 404/empty text | Wrong path selection, not successful page evidence | Existing status/ok fields expose the HTTP error; use discovered/canonical links. Do not retry guessed paths blindly. No handler rewrite needed. |
| Flash omitted search intent and retried | Historical schema/default mismatch | Already fixed at baseline in shared search schema/handler. A live `search.query` without intent succeeded with `intent:general`; did not duplicate the fix. |
| Cursor confused block/cache behavior and used replay action syntax | Description/contract confusion | Existing network descriptions now explain blocked+ruleId versus completed+fromCache and the plain replay tool. Kept the existing handler guards; historical replay results are not proof of a current network bug. |
| UI “Read page” labels led an audit to blame the wrong provider path | Evidence/provenance gap | This audit verifies actual arguments against native transcript records. Durable tool-id telemetry is a follow-up below. |
| Typecheck failed in earlier shared search changes | Existing incorrect type-import path and readonly test fixture | Corrected the ResearchSnapshot import depth and made the test's empty arrays match its mutable SearchResponse type. No runtime provider logic changed. |

The session guide now presents task-dependent routes, body capture order, literal batch arguments, and compact result controls. It does not require browser navigation for every public fact or remove native search. Current behavior is documented in [tools.md](tools.md) and [site-discover.md](site-discover.md). Context attachment/trust behavior did not change, so no provider-context contract was altered.

## Before/after measurements without restarting Electron

These are **local handler replays**, not live post-upgrade runs. Baseline handlers came from `5b87fb0ed07a`. Captured rendered pricing text was supplied as a plain-text session response; it is not the larger static HTML response used in the live comparison. DOM query replay uses exactly the two live rows above. Synthetic rows isolate the other regressions. Each side is one handler invocation unless indicated.

| Replay | Before | After | Meaning |
|---|---|---|---|
| Captured pricing text, full read → passage around Branching | 10,043 chars; 2.762 ms handler | 1,742 chars; 2.002 ms handler | 82.7% less returned context; both contain branching. After truthfully marks a partial window. |
| Captured DOM rows, full element objects → fields:[text] | 1,078 chars | 251 chars; 0.939 ms handler | 76.7% less context with identical two row texts and match counts. |
| Synthetic 30k document with branching at its end | 4,770 chars; 1.191 ms; generic cut, bodyTruncated false, evidence absent | 716 chars; 2.355 ms; evidence present, bodyTruncated true | Correct bounded evidence is the gain; not a CPU-speed claim. |
| Synthetic captured JSON with two large debug fields → titles only | 4,314 chars, clipped escaped JSON | 143 chars; 0.603 ms handler, valid projected JSON | 96.7% less context; one captured read, zero replays. |
| One retained API event appearing in both recorder views | count 2 | count 1 | Correctness fix; no model-call reduction claimed. |

Temporary replay artifacts during this audit: `/tmp/closedai-browser-audit-fixtures.json` and `/tmp/closedai-browser-replay.mjs`. The durable regression coverage is in the co-located tests, including large escaped text, continuation, a 200-character passage budget, mutation refusal, JSON projection, missing paths, binary/no-text rejection, and overlapping recorder views.

The old live comparison has no valid “after” wall-clock number until the app is rebuilt/restarted. The improved SPA recipe can start capture before navigation, avoiding the observed late-capture detour, but that end-to-end call reduction is a prediction, not a measured result.

## Verification and limits

- Focused initial batch: 52 tests passed across browser session, browser actions, CDP actions, and API map.
- Final text-window refinement and search fixture correction: 12 tests passed (session + grounding hints).
- Typecheck passed after fixing the two pre-existing shared-search blockers.
- Hygiene passed; size advisories were non-blocking.
- Guide generation/check, workspace map regeneration/check, and tracked/new-file whitespace checks passed.
- No renderer changes or visual claims. Main-process functionality requires a rebuilt app and restart.
- The audit itself incurred one invalid peer-read budget request (90k where the handler allows 16k), then used bounded pagination. Some candidate-file searches found no file; filenames were corrected. These are audit acquisition overhead, not silently added to browser benchmark timings.
- Full result recovery is limited by historical retention. Peer reads clip individual outputs; native result bodies were used for Astra/Claude size totals. Cursor generation/timing data remain unavailable.

## Highest-value follow-ups

1. **Cross-lane reruns with durable metrics.** Fresh-chat runs were subsequently authorized and completed below. Durable generation/result telemetry remains incomplete, especially for Cursor; do not infer missing metrics from UI labels or reasoning rows.
2. **Machine-readable document tables and scoped HTML extraction.** Text extraction can flatten column relationships and lose icon/aria labels; rendered query recovered Supabase's Free exclusion. Reason deferred: needs a distinct parser contract and fixtures across several real table patterns; passage search alone cannot promise table fidelity.
3. **Discovery depth and waste.** Bootstrap probes all channels by default and root llms candidates miss advertised paths such as Neon's `/docs/llms.txt`. Reason deferred: htmx discovery succeeded in 1.17 s; test a broader site corpus before changing channel defaults or adding bounded hint following.
4. **Captured-body/result handles for larger investigations.** Projection removes the immediate JSON problem, but long-lived snapshots would avoid repeated acquisition and changing text offsets. Reason deferred: retention, lifetime and private-session data policy need an explicit shared contract.
5. **Persist canonical tool identity and pass boundaries in history.** UI aliases and sampled spine evidence produced demonstrably wrong prior audit counts. Reason deferred: spans transcript/telemetry storage beyond the browser handler fixes; unavailable fields are marked rather than inferred.

## Fresh-chat cross-provider live runs

At the user's request, Cursor ran first and was monitored to completion, followed sequentially by Codex, Claude Code, and Antigravity. Each received the same single prompt containing four tasks: discover htmx `hx-get` from the docs; identify the HN Algolia `?q=electron` SPA endpoint and first three captured titles; extract Supabase Branching plan rows; compare Neon/Supabase Free storage, compute/pausing, and branching with official evidence. The prompt required read-only external work, owned tabs, capture cleanup, no repository edits/tests, citations, and an honest efficiency report. It supplied no expected answers or provider-specific tool recipe. No benchmark turn was steered mid-run.

Models were selected from the live app menu and confirmed in chat state: `cursor:composer-2.5[fast=true]`, `gpt-6-sol` (medium), `claude:opus[1m]` (medium; native transcript confirms `claude-opus-5-5`), and `agy:gemini-3.8-flash` (app effort medium). These were fresh threads with no audit transcript injected.

Before starting Cursor, a 200-character htmx session passage probe returned `matchOffset`, `nextOffset`, and truthful `bodyTruncated:true`, confirming the new handler live. Subsequent captured-body projections succeeded in the benchmark runs. This establishes those capabilities, not every fix in the earlier implementation table.

### Measured results

End-to-end time uses the app store's `messageSentAt` through `lastTurnEndedAt`, including startup and final streaming. Shared operations expand batch children and exclude the batch envelope itself. Native discovery/file calls are separate. The observer's monitoring and independent verification are excluded.

| Provider / model | End-to-end | Shared operations | Other calls | Model generations | Assessment |
|---|---:|---:|---:|---:|---|
| Cursor / Composer 2.5 Fast | **54.644 s** | 24 | 1 repository grep | Unavailable | Fastest sample; clear, sourced answers to all four tasks; core values independently corroborated. Extra table recovery and duplicate network listing. |
| Codex / GPT-6 SOL, medium | **242.650 s** | 25 | 3 catalog-discovery execs | 29 | Concise, grounded answers to all four. Serial calls, an oversized catalog read, two unhelpful request filters, and extra DOM inspection increased overhead. |
| Claude Code / Opus 5.5, medium | **59.118 s** | 13 (12 children in 4 batches, plus close) | 2 schema lookups | 8 | Correct core answers with compact reads and batching. Plan mapping inferred from flattened text; self-reported call counts inaccurate. |
| Antigravity / Gemini 3.8 Flash | **213.456 s** | 17 attempts (16 succeeded) | 15 file/schema searches and reads | 33 | Core task answers matched, but one transport retry, extensive source inspection, and unsupported statements in the final report. |

These are single runs in a shared, already-used browser session, not cold-cache trials or evidence of a general model ranking. Opus fetched later-task pages early despite the requested task order. Flash's transport failure further limits latency comparison. Composer was fastest here and its answer was articulate; the sample does not establish universal superiority.

Timing anchors (UTC):

- Cursor: 08:59:10.710 → 09:00:05.354; chat `5762d56f-8b7d-41f0-8994-e86c6394e9bf`, thread `cursor:199413d7-b82c-4f8c-a33c-93671f3e0357`.
- SOL: 09:00:15.005 → 09:04:17.655; chat `7370b3b3-77e0-47c0-bc13-167dd6e635f2`, thread `01a0f18b-0440-7e91-a0c6-ff87c0c8f1a0`.
- Opus: 09:04:39.867 → 09:05:38.985; chat `688ebe10-cebf-4248-90f0-f9299e1f9f13`, thread `claude:b2e38b97-f85b-4216-8325-c110aa0bfe33`.
- Flash: 09:06:02.685 → 09:09:36.141; chat `a8e86dcd-251e-4194-8e76-c53321c74347`, thread `agy:bc04c1dc-10ce-464c-8dcd-d55265555358`.

SOL's 29 generations are unique native `token_usage_record.response_id` values, including the final answer; its 28 exec calls include three catalog lookups and 25 tool operations. Opus's eight generations are unique native assistant message ids. Flash's 33 are `gen_metadata` rows at completion of its first turn. Cursor's retained live tool timestamps support timing/call counts, but its app transcript omits all 24 shared result bodies; reasoning-row counts are not substituted for generation counts.

Native retained result text totaled 109,877 characters for SOL's 28 exec outputs, including catalog discovery and wrappers, and 22,028 for Opus's seven tool results. These are different result envelopes, not a normalized token comparison. Cursor's returned-body total is unavailable. Flash's cache clips some outputs and omits a request-list body delegated to an output file, so no complete total is claimed. Summed displayed tool intervals were Cursor 7.379 s, SOL 6.982 s, Opus 3.982 s (batch envelopes), and Flash 2.165 s; these are not comparable pure browser-service times and exclude gaps between calls.

### Observed quality and efficiency

- **Shared capabilities worked across all four lanes.** Each armed capture before SPA navigation and used captured-body JSON projection. The observed endpoint was the Algolia `Item_dev/query` POST; the first three titles agreed across runs. This was an ordinary page-issued request, with no tool-issued POST or replay. All four avoided screenshots and repository edits/tests.
- **Cursor:** five task-1 calls, seven SPA calls including cleanup, eight table-task calls, and five comparison calls. It used both discovery and DOM link lookup for htmx; both passive and CDP request lists for the SPA; a 50k requested Supabase page read, two raw HTML windows, three evaluate calls, and an unrelated repository grep for the pricing table. Its final report acknowledged some duplication but omitted the grep. All 25 live tool rows completed; unavailable result bodies prevent a full truncation census. The final numeric/plan claims agree with the independent DOM and official-page checks.
- **SOL:** initial catalog discovery printed roughly 49,498 tokens before provider-side output truncation. Its broad htmx page read was also bounded before the needed passage. Filtering requests by `fetch` missed the XHR; filtering by `search` mostly found unrelated URLs; the full list recovered the correct id. It then projected the captured body correctly. Supabase row/header extraction preserved plan relationships; a follow-up HTML read was extra. A failed Neon `tr` match led to a broad `*` query before a focused grid read. No failed tool status or generic `_closedai_truncated` result was found. The final answer's “no retries” should not obscure these evidence-recovery calls.
- **Opus:** used bounded session passages and literal, correctly ordered capture/navigation/listing steps in a batch. It fetched Supabase pricing four times; two could have been combined. Its answer claimed five batches with 15 sub-calls, but actual arguments show **four batches with 12 sub-calls**, plus the separate tab close and two schema lookups. Core pricing claims matched independent rendered rows. The answers inferred column mapping from flattened text instead of extracting structured DOM cells. No generic serializer cut appeared in retained native results.
- **Flash:** 15 native file operations comprised four schema-discovery calls, nine repository searches/reads, and two reads of the same saved request-list output. It then projected five titles although three were requested. The initial SPA navigation failed with a local MCP connection reset; state inspection showed the blank tab, and one retry succeeded. The evidence does not establish that `wait_until:idle` caused the reset. Its final “no redundant calls” claim conflicts with the repeated source/output reads. Its “exactly 20 KB decoded” wording mistakes the captured response's `byteLength` for the much smaller projected result. It also declared additional Neon Free branches unavailable without obtaining explicit policy evidence; the empty pricing-table entry alone does not justify that negative claim. “No incomplete evidence” was therefore too strong.

Independent checks used the live Supabase Branching rows and header order, plus official Neon pricing/FAQ and Supabase pricing passages. They confirmed Free/Pro/Team/Enterprise branching values and the core free storage, compute, and idle figures. They do not establish every extra assertion in each answer.

### Cleanup and remaining work

Opus closed its capture tab. Cursor, SOL, and Flash issued `Network.disable`; that stops the network domain but does not prove debugger detachment. Cursor/SOL tabs were no longer present by the end. After preserving Flash's first-turn metrics, an untimed follow-up asked its owning chat to close the remaining capture tab; the observer's direct close was correctly refused by tab ownership. This cleanup turn is excluded from the table.

The runs reinforce two shared follow-ups: a compact table extraction result that preserves headers/cells, and an explicit capture lifecycle whose stop operation releases all armed state without requiring implementation-source inspection. Durable canonical tool/result telemetry is still needed to make every lane's output-size and generation measurements equally auditable. No provider-specific code changes were made for these tests.
