# Model context and instructions

Chat naming is app-owned metadata. Codex and Claude may run a separate ephemeral request with the
selected model after a completed exchange, using only bounded first-exchange text as untrusted
data. That request has a dedicated title-only instruction, no ClosedAI tool registry, and no
conversation continuation. It does not write a message into the user's transcript. Generated names
are descriptive labels, not verified facts or instructions; provider catalogs cannot overwrite them.

Source review: 2026-09-13. Common product facts, provider-specific rules, runtime context, and
repository documentation have separate owners. Editing a Markdown guide alone does not change
every running model's prompt.

Shared application guidance now routes authorized native-process experiments to
`native_instrument`, distinguishes discovery from injection, describes custom probe effects,
and requires operation-receipt reconciliation after uncertainty. It marks native output as
untrusted. Parameter limits remain owned by the tools; see [native instrumentation](native-instrumentation.md).

## Instruction assembly

| Layer | Owner | Delivery |
|---|---|---|
| Common product facts and tool routing | `src/main/chat-context/application-instructions.ts` | Included by Codex, Claude, Antigravity, and Cursor instruction builders |
| Response style | `src/main/chat-context/articulation-instructions.ts` | Included by all four builders; direct responses, useful progress, verification and limitations, and Markdown links for referenced pages |
| Engineering workflow | `src/main/chat-context/engineering-instructions.ts` | Structured edits, task-appropriate verification, preservation of Git state, and each provider's native tool names |
| Codex adapter guidance | `src/main/chat-context/developer-instructions.ts`, `thread-params.ts` | `developerInstructions` on thread start and resume, alongside Codex's base instructions |
| Claude adapter guidance | `src/main/claude/claude-instructions.ts`, `claude-options.ts` | Appended to the SDK's `claude_code` system preset when a query runtime starts |
| Antigravity adapter guidance | `src/main/antigravity/antigravity-instructions.ts`, `antigravity-profile.ts` | Written to the app-private `agent.md`; loaded through `--agent closedai` and `--add-dir` on CLI startup |
| Cursor adapter guidance | `src/main/cursor/cursor-instructions.ts`, `cursor-input.ts` | Once per ACP session, as a `closedai.instructions` application context block on the first turn; turn context and handoff on later turns |
| Repository rules | `src/main/chat-context/workspace-rules.ts`, root `AGENTS.md`, applicable `CLAUDE.md` | Codex loads `AGENTS.md` natively; Claude and Antigravity receive the selected workspace root policy explicitly; Claude also loads project `CLAUDE.md` through the SDK |

The common product facts are ordered as identity and objective, trust and authorization, choosing
between tools, then workspace orientation (restructured 2026-09-20; about 5,200 characters). Every
lane assembles the same way: the provider's one-line "who and where", the shared block, transport
and trust mechanics, lane-specific overrides, engineering, and response style last. Parameter
names and defaults are deliberately absent from the shared block; the tool descriptions the
registry delivers own them, so a tool change cannot strand a stale fact in the prompt.

The block opens with platform identity: ClosedAI is an Electron desktop app whose
main process owns the browser pane as Chromium tabs on one shared signed-in session, beside chat
panes routed to the four providers. The paragraph names what the platform already provides (PDF
viewer, accessibility tree, DevTools protocol, downloads, printing, media) and asks models to check
the platform and existing tools, with current official documentation, before building extraction,
rendering, viewing, or capture. It was added on 2026-09-20 after a model built a PDF.js/OCR
pipeline beside the native PDF viewer it had already screenshotted. The facts then define the
model as the user's collaborator inside their OS and that browser, free to choose its approach and
available tools for authorized work.
Models should use their knowledge, reasoning, and reach to improve the user's starting approach
and deliver a useful, accurate, finished result. More research, tool calls, or output alone do not
establish higher quality; the block states this once, under "Research serves decisions", rather
than repeating it per tool.
The trust paragraph adds that a rotation, restart, or handoff is a point to re-check the approach
against the platform and the objective, not a reason to continue the prior scope unexamined; the
same 2026-09-20 case ran through four rotations that each inherited the earlier plan.
This role has one shared owner; adapters supply transport and provider facts. Models recover the
intended outcome and respect explicit constraints, while treating diagnoses and proposed methods
as hypotheses when their accuracy affects the result. Evidence selection is task-dependent: local
state, authoritative APIs, current documentation, original research, or firsthand experience reports.
Current evidence is the starting point; older work remains useful when applicable or foundational,
and software guidance must match the relevant version. Models may investigate a plausible better
approach within the user's objective. Quality comes first, latency close behind, token cost third.
Claude's explicit preset override permits this objective-bounded work without overriding user
constraints. Evidence guidance distinguishes observations from hypotheses.

Independent retrieval and execution overlap; choices that depend on missing evidence wait. Research
stops when important decisions are supported, material contradictions are resolved or disclosed,
and further findings are unlikely to change the approach. Models read needed sources and cancel
unnecessary pending work instead of waiting for every source. The task itself still requires a
finished, verified result. Failed approaches are adapted; retries account for prior effects;
authorization, cancellation, budgets, and trust boundaries remain binding. Search, library lookup,
and checkpoints are not mandatory on every task. No evaluator or extra planning model call is added.
Stripe Directory is used when explicitly requested or when its vendor discovery or purchase
capabilities materially help. This explicitly overrides the `stripe-directory` skill's blanket
software/service discovery trigger: a suitable option that can be verified directly does not need
a supplementary directory lookup. Required payment, authorization, and safety steps still apply.
The skill is a Codex plugin, so the rule lives in the Codex adapter (`developer-instructions.ts`),
not in the shared block or the installed plugin cache; the other lanes do not carry it.
This is provider-shared prompt guidance, not an enforced scheduler, automatic continuation mechanism,
or guarantee of task completion. Instruction assembly tests verify delivery; behavioral effectiveness
requires live task evaluation. Existing provider sessions need refreshed instructions before evaluating it.

The deferred project-switch command is a specific runtime continuation mechanism, separate from
that general guidance. `closedai_app.command project_switch` with `project_op: request` validates the
calling pane/thread/turn and an existing absolute directory, then waits for all chats to be idle.
The caller must end its turn after a pending receipt. The destination gets a new chat with the
existing bounded, untrusted conversation handoff and frozen source lineage; a fixed continuation
message asks it to finish only the previously authorized task and verify its working directory.
Focus does not determine the source. The latest status is readable through app state, and
`project_op: cancel` releases a pending request. Cancellation, source replacement, and shutdown do not
start a continuation. Failures are exposed without automatic retries; completed describes
switch-and-submit, not task completion. Pending state is in memory only.
The app no
longer adds a blanket restriction on delegation; applicable user and repository instructions still apply.
The sidebar groups chats across directories. Manual directory navigation keeps running chats in
their original directories; the model's deferred project-switch command still waits for idle and
creates a continuation. Stable chat ids, the shared browser/sidebar, and the distinction between pane turns and provider
background work provide orientation. App facts come from `closedai_app.state`,
service operations from `closedai_app.command`, and real renderer interaction from manifest
control ids through `closedai_app.ui`. The chat section defaults to the calling pane (including its
model, thread, and `cwd`), falling back to selection only when there is no caller. `pane_id` explicitly
overrides that target. Workspace state separately identifies caller and selection. Other panes and
previous conversations are readable through `peer_chats`.
Renderer chat/composer control ids target the focused tile; use `layout.pane-drag` with a chat id
to focus another tile before exercising its controls. The UI state includes visible pane ids and
browser visibility. Browser pages use the CDP tools described in [Tools](tools.md) and [CDP](cdp-tool-foundation.md).
Shared guidance also states that page-requested popups, including login windows, open as regular
browser tabs with native opener behavior; they use the same tab ids, capture and input tools.
Chats can dock on either side of the shared browser via `layout.browser-dock`; the browser's
position and visibility are saved per directory with the chat layout.
Press `layout.new-chat` (the header `+`) to add a conversation tab (`layout.split-right` and
`layout.split-below` sit in the header's context menu), `layout.tab` to select one, and `layout.tab-close`
to remove it from the tile; each control's item is the chat id. Switching or removing a tab does
not stop its running turn or delete its history.
The common routing policy prefers deterministic commands, page APIs, the session-owned
`embedded_browser.network` and `session` tools, page `query`/`evaluate`/`console`, fetch/extract,
and non-input CDP. Deeper runtime inspection, debugging, profiling, instrumentation, emulation
and exact CDP response reads are task-driven capabilities, with no required recon workflow.
CDP request listings retain repeated URLs and child session identities; child body reads pass
that session id and never reissue the request. Session-log ids are not CDP ids. The legacy
session-network body action is removed; `embedded_browser.network_replay` explicitly sends a
new request and may repeat server-side effects. Instrumentation never wraps eval/Function;
its observable wrappers report patch status and best-effort restoration.
Real clicks, manual typing, key presses, and raw `Input.*` commands are recorded escape hatches:
the call requires `fallback_reason` and belongs in one batch with inspection and post-action
verification. For Codex the containing exec script is the batch; direct-call lanes use `tool_batch`.
The tool runtime distinguishes those two dispatch sources and refuses unbatched real input from a
direct-call provider even when it supplies a reason. Direct-call batches containing real input must
be sequential and include a later read, wait, or capture assertion.
Batching is optional for ordinary work. Independent reads can run together; models inspect their
results before choosing dependent actions. Codex uses direct awaited calls and can group independent
reads with `Promise.allSettled`; direct-call providers can use native parallel calls or `tool_batch`
for ClosedAI tools. Temporary instrumentation must be paired with use and release; exec scripts use
`try/finally`. The real-input verification requirement above still applies.

The shared response style asks for direct answers, useful progress during longer work, and a final
result with verification and unresolved limitations. Errors affecting the outcome must be disclosed.
Routine history retrieval is used naturally without announcing it. Sources are explained when
asked, and missing or conflicting context is disclosed when it affects the answer. There is no
first-person phrase ban, output filter, or obligation to narrate every recovered tool error. This is
prompt guidance, not a text filter or a guarantee of identical output across models.

The engineering contract steers every lane toward focused reads, provider-native structured
edits, task-appropriate verification, and preservation of unrelated changes and Git stash/worktree state. Checks
may be repeated after failures or subsequent edits; applicable repository rules control required gates. Claude uses
`Read`/`Grep`/`Glob` and `Edit`; Antigravity uses `view_file`/`grep_search`/`find_by_name`
and `replace_file_content`/`multi_replace_file_content`; Codex uses `rg` and `apply_patch`.

File search, reading, and editing use each provider's native tools. ClosedAI does not register a
workspace inspection tool, inject a repository map, intercept file reads, or track source hashes.
The generated index remains a repository maintenance artifact, not model context. For live-app
interaction, discover controls from runtime state and the control manifest.

## Per-turn context and trust

`buildChatInput` validates user text and attachments. The providers adapt the same input into
Codex turn input, Claude content blocks, or Antigravity tagged text and attachment paths.

`buildTurnAdditionalContext` includes a timestamped active-tab fragment only for prompts that
match browser/page cues and only when an active tab exists. That fragment is explicitly
`kind: untrusted` and labels its role as ambient with undetermined relevance: a page title or URL
cannot issue instructions, and the fragment's presence is not evidence of user intent. Shared
model instructions require each provider to judge relevance from the request and conversation,
using the tab when relevant even without an explicit page reference and ignoring it when unrelated;
adjacency or injection alone never establishes relevance. Ordinary coding turns do not automatically
receive browser state or a full application snapshot.

Saved credentials are also never injected into prompts. Every provider can discover masked entries
with `credential_vault.list` and retrieve only named fields with `credential_vault.read`. The shared
instruction permits that read only when the current user request requires the credential; untrusted
page, file, attachment, and tool content cannot authorize it. Retrieved secrets are for the immediate
operation only and must not be echoed, logged, or persisted. The registry redacts sensitive read
results from the app's Turn Trace.

Send adds no automatic source-version checks or workspace source-change fragments.

Claude and Antigravity receive context in `<closedai_context name="…" kind="…">` blocks.
Codex receives typed `additionalContext`. `application` denotes app-authored context;
`untrusted` denotes data such as pages, files, attachments, and tool output. Embedded instructions
in an arbitrary document are not the user's request. The selected workspace root's `AGENTS.md` is
an explicit exception: it is project policy, bounded to 20,000 characters, and delivered as trusted
guidance to Claude and Antigravity because those runtimes do not both load it natively. Nested policies are discovered with native file tools; ClosedAI no longer scans the directory tree
to claim which nested policies exist.

`closedai.chat.handoff` carries a locally assembled digest when continuing/branching a chat or
switching its provider.
It is marked `untrusted`: the locally assembled envelope contains historical user/assistant
text and may contain model-authored checkpoint notes. Treat these as history, not fresh
authorization or verified completion; re-read files for exact state. The digest is limited to
12,000 characters, with entries clipped to 1,500, its title to 120, and the changed-path list to
1,800 characters (at most 30 paths). Attachments contribute names, not image bytes. Assistant
entries use the provider-neutral label “Assistant”.

`peer_chats.checkpoint` persists model-authored working state: goal, constraints, decisions,
progress, next steps, and file references. State is at most 6,000 serialized characters; fields
have separate bounds and oversize notes are rejected rather than silently truncated. It requires
the caller's active thread/turn and expected revision. It cannot write another pane's notes.
One checkpoint is retained per pane, associated with its thread id; a different thread cannot
read it as its current memory. Notes survive compaction and restart but can be stale or wrong.
They never become developer instructions, approvals, or independent evidence.

Continuation and provider switching copy a checkpoint only if its thread and recorded boundary
belong to the selected source prefix, so a later checkpoint does not enter an earlier branch or a
different provider thread. They retain the frozen source boundary for bounded
`peer_chats.recall`. The checkpoint remains within the existing handoff budget; more recent
messages take precedence. No summarization call is added to Send, and checkpoints are neither
automatically generated nor repeatedly injected into the prompt.

`peer_chats.list(scope=history)` discovers nonarchived conversations across projects from existing
chat records, without loading transcripts. It excludes the caller and empty chats, sorts by most
recent user submission (falling back to turn completion or creation for older records), and returns
up to five compact entries, at most eight, within 16k serialized characters. Pinning and incidental
record updates do not change this ranking. `query` matches titles, previews, project directories,
and applicable checkpoint notes; `cwd` optionally filters by project. Discovery is metadata search,
not full-text or semantic search. A stable chat-id cursor pages older entries. Explicit topic
references take precedence over recency in the model's retrieval guidance.

`peer_chats.recall` returns bounded excerpts and checkpoint state. `current` reads the caller's
transcript; `source` reads its direct continuation capped at the saved branch boundary. After
session rotation on the same pane, `source` prefers the live in-memory transcript through that
boundary so omitted tool output stays reachable even though the provider thread id changed.
`history`
reads a discovered `chat_id`, or defaults to the most recent other conversation. It uses an available
live transcript or the existing provider reader with the source project directory; no chat is
selected and no message is sent. The result identifies the selected history chat. User/assistant
messages are the default; `types` requests other textual evidence. Transcript phrase search and
exact-message expansion share the existing recall implementation and 16k output budget. Cursor
serializes history loads because ACP shares one replay collector. Missing history, provider errors,
changed targets, caller changes, and cancellation are surfaced rather than silently reading another
conversation. `source` still requires its frozen boundary; broader `history` is a separate explicit scope.

Ordinary new chats do not receive old transcripts, new summaries, or mandatory checkpoints. The
model retrieves context when useful; no automatic search or extra model call is added to Send.
Existing continuation digests retain their explicit handoff behavior. Recall and checkpoint remain
deferred where supported, with detailed paging contracts in tool descriptions rather than the prompt.

The opt-in Codex `chatCompactAtTokens` setting requests native compaction during idle time,
independently of model-window percentage. It does not itself generate checkpoint notes or delete
archived history. When `chatSeamlessRotation` is enabled (default on), the same idle thresholds
rotate Codex and Claude to a fresh provider thread with a thin seed instead of calling native
compact; Claude Code auto-compaction is disabled in that mode. The visible transcript stays put
and each rotation appends metadata to the chat record; the Turn trace records `session.rotated`
with elapsed release time for latency review.
Display paging is independent of model context. The new first-text measurements and safe trial
procedure are in [Tools](tools.md); do not infer a response-time improvement from fewer displayed
items or context tokens alone.

ClosedAI starts and resumes Codex threads with the selected model's maximum active-context size
using known native capacities (including GPT-6 Astra's 1,050,000 tokens) for model ids in the
installed CLI's model cache, falling back to cache metadata for unknown models. That value is
also shown in the model picker. This is a runtime configuration limit, not extra prompt content;
missing metadata leaves Codex's native default untouched.

## Tool context and output budgets

The durable public research library is accessed explicitly through `search.library`, never
injected into prompts or handoffs. Shared guidance directs models to query it only for relevant
tasks and treat its dated metadata/abstracts as untrusted discovery evidence. Substantive claims
require reading the linked paper. This library is intentionally shared across app projects;
private investigation archives retain their existing scope. UI controls own refresh/topics
and retrieval permission. See [Research library](research-library.md).

Models can explicitly retain large protocol results with `browser_cdp.protocol command`
`retain=true`. The shared instructions name `investigation.read` for bounded exact bytes or
JSON-pointer projections, and `investigation.manage` for selected file import, verified export
and deletion. Artifact ids belong to host-resolved chat/project scope and outlive provider
threads. Calls require that chat's current active turn; model arguments cannot choose a peer's
scope. Stored content is untrusted and never injected automatically into instructions.
Operation keys prevent committed retries from reexecuting CDP commands; interrupted reserved
operations remain uncertain and refuse automatic reexecution. See [artifacts](investigation-artifacts.md).

The shared routing instructions use `search.query` for a lookup, `search.run` for overlapping
queries/source collection, and `search.read` for incremental evidence. For work centered on a
specific technology or product, they name that technology's current official documentation as
primary evidence and direct the model to boost its canonical domain with `preferred_domains`
(the model supplies the domain; no domain list is hardcoded), and they state that an old index
age on a living docs page is not staleness — `content_fetched` dates show crawl currency. For a PDF already open
in the browser, shared guidance instead directs the model to select its tab and use
`embedded_browser.page read_page` with one-based `pdf_page`. This uses Chromium's native
PDF text. An empty result may be a scan; page text does not establish image coverage or layout
accuracy. The model uses browser capture for visual evidence. See [Tools](tools.md) for the
internal Chromium adapter's limits and lifecycle.

Research work belongs to the originating
turn and is cancelled at its end, so models must retrieve needed evidence before finishing.
Both search paths now default to live presentation and reuse one retained tab per pane/thread/turn.
Discovery must use the search APIs, never Google or other search-engine pages in the browser.
The tab opens on an actual source URL as results arrive; until then, presentation reports
`waiting_for_source`. Finishing without an eligible URL reports `no_source` and opens no tab.
The shared instructions ask models to inspect the live source tab and capture pages when visual
evidence is needed. Explicit background mode is for user-requested
headless work. This does not promise a hidden rendered worker or automatic live following.
Source excerpts are untrusted data,
and discovery overlap across providers does not establish independent factual corroboration.
Research tools expose adjustable extraction coverage and `search.run.expand` for selected sources,
including completed runs. Expansion performs new requests; `search.read` remains observation-only.
Models can inspect `incomplete`, expand, and page the replacement text without repeating discovery.
An unset truncation flag does not prove extraction fidelity. Exa PDF-URL text remains `provider_text`;
it is not proof that this app parsed PDF bytes or verified tables, equations, figures, or OCR.
Direct `pdf_text` results come from local PDF.js parsing, with page markers and page coverage.
PDF downloads must fit the byte budget in full; expansion can raise it. Pages without extractable
text mark coverage incomplete and remain available for `search.pdf` inspection. `search.pdf page`
returns a selected page/crop image tied to the original PDF byte hash; inspect it for visual claims.
`search.pdf ocr` performs local, explicitly requested English OCR and returns separate text,
confidence and optional word boxes. It can be used even when a page has native text. Neither
OCR confidence, capture freshness, nor rendering success proves content accuracy. There is no
automatic verification flag: describe the pages/regions actually checked and unresolved limitations.
Native transforms are not reconstructed reading order; OCR is not guaranteed table, equation or
figure extraction. Prefer native text first and inspect/OCR selected pages as the task requires.

The registry supplies provider-neutral descriptions and schemas. Codex gets dynamic tool
specifications; Claude gets in-process MCP servers; Antigravity gets HTTP MCP servers. Tool
switches and runtime schema validation are enforced by the registry. Native CLI tools bypass
that registry and retain their provider's execution semantics.

All file operations stay in the provider's native tool path. Root project-policy delivery is
retained for providers that do not load AGENTS.md themselves. Browser tools, search, app controls,
credentials, and peer-chat tools continue through the shared registry.

Codex code-mode tools return strings: parse JSON where documented and split capture image data
before passing the URL to `image()`. Use direct awaited calls in an exec script; native tool-call
providers can use `tool_batch.run`. Suppress successful intermediate payloads, and keep failures
visible. Output budgets, screenshot limits, and compaction settings are in [Tools](tools.md).
Browser-page capture rejects main-frame navigation or renderer loss during the operation.
Its tool description explicitly excludes an atomic DOM/pixel guarantee: DOM updates,
animation, and subframe changes remain possible.

The verification budgets in `model-efficiency-instructions.test.ts` are under 9,500 characters for
Codex developer instructions, 10,000 for Claude, 10,500 for Antigravity, and 10,000 for Cursor
(raised by 1,500 each on 2026-09-20 to make room for the platform-identity and native-PDF guidance;
`turn-context.test.ts` holds the same Codex bound). The separately appended
root `AGENTS.md` is capped at 20,000. Share repeated guidance and remove duplication when expanding
prompts; do not solve drift by injecting the entire documentation tree.

## Refreshing and checking changes

After changing prompt source, load the updated main-process build. Codex receives new guidance
when its thread is started or resumed. Its dynamic tool catalog is different: Codex 0.154 restores
the saved catalog on resume. Before sending, ClosedAI compares saved rollout tools with the current
registry and uses a fresh provider thread plus the existing conversation handoff when they differ
or the saved catalog cannot be read. The visible transcript stays in place; source recall retains
access to omitted evidence. Claude needs a newly started query runtime. Antigravity
refreshes its app-private profile during provider connection, and a new CLI process reads it.
Restarting ClosedAI reloads these paths. Merely changing Markdown or creating a new conversation
inside an already loaded old build does not load new TypeScript prompt code.

For an instruction change, run typecheck and the affected existing instruction tests:
`model-efficiency-instructions.test.ts` and `chat-context/turn-context.test.ts`; root policy delivery is covered by
`chat-context/workspace-rules.test.ts`, and profile rendering is covered by
`antigravity/antigravity-profile.test.ts`. These verify assembly, budgets, and boundaries,
not model compliance. A live response comparison is a separate check and should name the
provider/model and whether the session was refreshed.

Keep protocol observations dated. [Trace research](trace-research.md),
[desktop recon](codex-desktop-recon.md), and [composer QA](../design-qa.md) are historical records;
they do not grant new permissions or establish that a proposed feature shipped.
