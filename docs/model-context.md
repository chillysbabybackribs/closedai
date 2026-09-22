# Model context and instructions

Chat naming is app-owned metadata. Codex and Claude may run a separate ephemeral request with the
selected model after a completed exchange, using only bounded first-exchange text as untrusted
data. That request has a dedicated title-only instruction, no ClosedAI tool registry, and no
conversation continuation. It does not write a message into the user's transcript. Generated names
are descriptive labels, not verified facts or instructions; provider catalogs cannot overwrite them.

Source review: 2026-09-21. Common product facts, provider-specific rules, runtime context, and
repository documentation have separate owners. Editing a Markdown guide alone does not change
every running model's prompt. Product behavior and UI ownership live in
[Application guide](application.md); tool contracts live in [Tools](tools.md).

Shared application guidance explicitly overrides the Visualize skill's delivery format:
ClosedAI has no inline visualization-marker renderer or `Tweak`/`window.openai` host runtime.
Models should serve standalone HTML locally, verify it in the embedded browser, and share
the HTTP link. Absolute HTML file links open a source preview, not an executable page.

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

The shared product block lives in `application-instructions.ts` (~7,800 characters as of
2026-09-21). It is ordered as identity and objective, trust and authorization (including evidence
claims), tool routing, then workspace orientation. Parameter names and defaults stay in tool
descriptions so registry changes do not strand stale facts in the prompt. Every lane assembles:
provider "who and where", the shared block, transport/trust mechanics (`product-instructions.ts`),
lane overrides, `engineering-instructions.ts`, and `articulation-instructions.ts` last.

Do not mirror the full block in Markdown — edit the TypeScript source and run
`model-efficiency-instructions.test.ts` plus lane-specific instruction tests. Budget ceilings
today: Codex developer text under 9,500 characters; Claude/Cursor under 10,000; Antigravity under
10,500 (`model-efficiency-instructions.test.ts`).

Lane-specific notes (not duplicated in the shared block):

- **Codex** — Stripe Directory narrowing, exec JSON parsing, capture URL handling, and poll/write_stdin
  hints in `developer-instructions.ts`.
- **Claude** — Preset scope override for objective-bounded work in `claude-instructions.ts`.
- **Antigravity** — File-link anchor discipline in `antigravity-instructions.ts`.
- **Cursor** — First-turn `closedai.instructions` block in `cursor-instructions.ts`.

Product behavior the prompt only summarizes (details elsewhere):

- **Workspace UI** — [Application guide — Workspace layout](application.md#workspace-layout).
- **Browser coordination locks** — [Tools — Application facts](tools.md#application-facts-browser-targets-and-batching).
- **project_switch** — Command schema in `closedai_app.command`; runtime flow in
  [Application guide](application.md).

Routing policy in the shared block: prefer page/session/network tools and script `query`/`evaluate`
before CDP dumps; `fallback_reason` plus verification for real input; batching optional for reads.
Verification is risk-proportional: use a direct check for low-risk reads, targeted checks around
routine changes, and before/after checks for mutations or externally visible actions. Avoid repeated
checks that cannot change the decision, and ask only for missing input that materially changes the
result. Browser work prefers a fresh assigned tab, while a clearly relevant ambient read may reuse
the current tab.
File search and edits use provider-native tools; no workspace map injection.

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
entries use the provider-neutral label “Assistant”. **Continue in new chat** (`chat.message-continue`) and
**Branch** (`chat.message-branch`) both attach a digest on the new chat's first send; Continue carries
the conversation through its current end (recall boundary at the last transcript item, often the latest
user message), while Branch ends the digest and recall at the chosen assistant message. A continuation
also states where the source stood (“Where it stood: N user requests; the latest request was answered” or
“…had no completed answer when the chat was continued”) and, when known, the source's working
directory; these lines are descriptive history under the same untrusted envelope, not instructions.
Compaction and rotation seeds keep their own preambles without them.

Legacy working checkpoints may still exist on a chat record from earlier builds. They are
model-authored notes (goal, constraints, decisions, progress, next steps, file references),
not verified facts, and are not written by current tools. When present, they can appear in
recall excerpts and the Context Inspector.

Continuation and provider switching copy an applicable legacy checkpoint into the handoff when
its thread and recorded boundary match the selected source prefix. They retain the frozen source
boundary for bounded `peer_chats.recall`. Checkpoints are not automatically generated or injected
each turn.

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
also reflected in the context meter under the composer. This is a runtime configuration limit, not extra prompt content;
missing metadata leaves Codex's native default untouched.

## Tool context and output budgets

The public research library is a user-facing dialog and on-disk index only; models do not have a
library tool and its abstracts are never injected into prompts or handoffs. Substantive claims
require opening linked papers through normal browser and research tools. See
[Research library](research-library.md).

Models can explicitly retain large protocol results with `browser_cdp.protocol command`
`retain=true`, returning a compact receipt backed by scoped SQLite storage. There is no separate
model-facing read/list/export tool. Operation keys prevent committed retries from reexecuting CDP
commands; interrupted reserved operations remain uncertain and refuse automatic reexecution. See
[Tools](tools.md) and [CDP tool foundation](cdp-tool-foundation.md).

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
The assigned tab opens in the background on an actual source URL as results arrive, preserving UI
selection; until then, presentation reports
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
text mark coverage incomplete. For PDFs already open in Chromium, use `embedded_browser.page
read_page` with `pdf_page`; use capture when layout or figures matter. Native text is not OCR,
table structure, or reading-order verification.

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
