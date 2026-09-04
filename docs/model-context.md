# Model context and instructions

Source review: 2026-09-04. Common product facts, provider-specific rules, runtime context, and
repository documentation have separate owners. Editing a Markdown guide alone does not change
every running model's prompt.

## Instruction assembly

| Layer | Owner | Delivery |
|---|---|---|
| Common product facts and tool routing | `src/main/chat-context/application-instructions.ts` | Included by Codex, Claude, Antigravity, and Cursor instruction builders |
| Response style | `src/main/chat-context/articulation-instructions.ts` | Included by all four builders; direct responses, useful progress, verification and limitations, and Markdown links for referenced pages |
| Engineering workflow | `src/main/chat-context/engineering-instructions.ts` | Shared narrow-read, structured-edit, verification, Git-state, and delegation policy plus each provider's native tool names |
| Codex adapter guidance | `src/main/chat-context/developer-instructions.ts`, `thread-params.ts` | `developerInstructions` on thread start and resume, alongside Codex's base instructions |
| Claude adapter guidance | `src/main/claude/claude-instructions.ts`, `claude-options.ts` | Appended to the SDK's `claude_code` system preset when a query runtime starts |
| Antigravity adapter guidance | `src/main/antigravity/antigravity-instructions.ts`, `antigravity-profile.ts` | Written to the app-private `agent.md`; loaded through `--agent closedai` and `--add-dir` on CLI startup |
| Cursor adapter guidance | `src/main/cursor/cursor-instructions.ts`, `cursor-input.ts` | Once per ACP session, as a `closedai.instructions` application context block on the first turn; turn context and handoff on later turns |
| Repository rules | `src/main/chat-context/workspace-rules.ts`, root `AGENTS.md`, applicable `CLAUDE.md` | Codex loads `AGENTS.md` natively; Claude and Antigravity receive the selected workspace root policy explicitly; Claude also loads project `CLAUDE.md` through the SDK |

The common product facts explain stable chat ids, the shared browser/sidebar, and the distinction
between pane turns and provider background work. App facts come from `closedai_app.state`,
service operations from `closedai_app.command`, and real renderer interaction from manifest
control ids through `closedai_app.ui`. Other panes are readable through `peer_chats`.
Renderer chat/composer control ids target the focused tile; use `layout.pane-drag` with a chat id
to focus another tile before exercising its controls. The UI state includes visible pane ids and
browser visibility. Browser pages use the CDP tools described in [Tools](tools.md) and [CDP](cdp-tool-foundation.md).
Use `layout.new-chat` to add a conversation tab, `layout.tab` to select one, and `layout.tab-close`
to remove it from the tile; each control's item is the chat id. Switching or removing a tab does
not stop its running turn or delete its history.
The common routing policy prefers deterministic commands, page APIs, the session-owned
`embedded_browser.network` and `session` tools, page `query`/`evaluate`/`console`, fetch/extract,
and non-input CDP. Real clicks, manual typing, key presses, and raw `Input.*` commands are recorded escape hatches:
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
There is no first-person phrase ban or obligation to narrate every recovered tool error. This is
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

`closedai.chat.handoff` carries a locally assembled digest when continuing/branching a chat.
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

Continuation copies a checkpoint only if its recorded boundary belongs to the selected source
prefix, so a later checkpoint does not enter an earlier branch. It remains within the existing
handoff budget; more recent messages take precedence. No summarization call is added to Send,
and checkpoints are neither automatically generated nor repeatedly injected into the prompt.

`peer_chats.recall` returns bounded historical excerpts and checkpoint state. `current` searches
the caller's own transcript; `source` accesses only the direct continuation source, capped at
its saved last-item boundary. Source history uses the live pane when available or the provider's
existing history reader; it does not select or send to the source. Missing boundaries, including
older continuations without one, fail closed. Late replies after a workspace/thread switch are
rejected. Read errors do not silently fall back to unrestricted history. These tools are deferred
where supported, and their descriptions carry limits so the common prompt stays small.

The opt-in Codex `chatCompactAtTokens` setting requests native compaction during idle time,
independently of model-window percentage. It does not itself generate checkpoint notes,
delete archived history, or rotate provider sessions. Display paging is also independent of
model context. The new first-text measurements and safe trial procedure are in [Tools](tools.md);
do not infer a response-time improvement from fewer displayed items or context tokens alone.

ClosedAI starts and resumes Codex threads with the selected model's maximum active-context size
from the installed CLI's model cache. That value is also shown in the model picker. This is a
runtime configuration limit, not extra prompt content; a missing cache value leaves Codex's native
default untouched.

## Tool context and output budgets

The shared routing instructions use `search.query` for a lookup, `search.run` for overlapping
queries/source collection, and `search.read` for incremental evidence. Research work belongs to the originating
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

The verification budgets are under 5,625 characters for Codex developer instructions, 6,500 for
Claude, 7,750 for Antigravity, and 7,000 for Cursor. The separately appended
root `AGENTS.md` is capped at 20,000. Share repeated guidance and remove duplication when expanding
prompts; do not solve drift by injecting the entire documentation tree.

## Refreshing and checking changes

After changing prompt source, load the updated main-process build. Codex receives new guidance
when its thread is started or resumed; Claude needs a newly started query runtime. Antigravity
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
