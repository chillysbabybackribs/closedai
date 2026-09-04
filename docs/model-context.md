# Model context and instructions

Source review: 2026-09-03. Common product facts, provider-specific rules, runtime context, and
repository documentation have separate owners. Editing a Markdown guide alone does not change
every running model's prompt.

## Instruction assembly

| Layer | Owner | Delivery |
|---|---|---|
| Common product facts and tool routing | `src/main/chat-context/application-instructions.ts` | Included by all three provider instruction builders |
| Response style | `src/main/chat-context/articulation-instructions.ts` | Included by all three builders; outcome-first responses and meaningful updates without first-person work narration |
| Engineering workflow | `src/main/chat-context/engineering-instructions.ts` | Shared narrow-read, structured-edit, verification, Git-state, and delegation policy plus each provider's native tool names |
| Codex adapter guidance | `src/main/chat-context/developer-instructions.ts`, `thread-params.ts` | `developerInstructions` on thread start and resume, alongside Codex's base instructions |
| Claude adapter guidance | `src/main/claude/claude-instructions.ts`, `claude-options.ts` | Appended to the SDK's `claude_code` system preset when a query runtime starts |
| Antigravity adapter guidance | `src/main/antigravity/antigravity-instructions.ts`, `antigravity-profile.ts` | Written to the app-private `agent.md`; loaded through `--agent closedai` and `--add-dir` on CLI startup |
| Checkout orientation | `src/main/chat-context/workspace-navigation.ts` | App-authored prose plus the generated repository map from `workspace-map.ts`, only when the session cwd matches `WORKSPACE_INDEX_ROOT` |
| Repository rules | `src/main/chat-context/workspace-rules.ts`, root `AGENTS.md`, applicable `CLAUDE.md` | Codex loads `AGENTS.md` natively; Claude and Antigravity receive the selected workspace root policy explicitly; Claude also loads project `CLAUDE.md` through the SDK |

The common product facts explain separate chat panes, their shared browser, and the distinction
between pane turns and provider background work. App facts come from `closedai_app.state`,
service operations from `closedai_app.command`, and real renderer interaction from manifest
control ids through `closedai_app.ui`. Other panes are readable through `peer_chats`.
Browser pages use the CDP tools described in [Tools](tools.md) and [CDP](cdp-tool-foundation.md).
The common routing policy prefers deterministic commands, page APIs, fetch/extract, and non-input
CDP. Real clicks, manual typing, key presses, and raw `Input.*` commands are recorded escape hatches:
the call requires `fallback_reason` and belongs in one batch with inspection and post-action
verification. For Codex the containing exec script is the batch; direct-call lanes use `tool_batch`.

The shared response style asks for results and evidence, with progress only when it adds a new
result, blocker, or required choice. It discourages “I have…”, “I am…”, and “I will…” work logs.
It is prompt guidance, not a text filter or a guarantee of identical output across models.
Quoted user text and historical transcripts are not rewritten.

The engineering contract steers every lane toward focused reads, provider-native structured
edits, one targeted verification pass, and preservation of Git stash/worktree state. Claude uses
`Read`/`Grep`/`Glob` and `Edit`; Antigravity uses `view_file`/`grep_search`/`find_by_name`
and `replace_file_content`/`multi_replace_file_content`; Codex uses `rg` and `apply_patch`.

The checkout capsule links [Application](application.md), this guide, and [Tools](tools.md).
It does not inline their full contents. Models retrieve the relevant document or source when
needed. `closedai_workspace.inspect find` and `outline` provide focused source navigation, and
`find` includes bounded hashed source, referenced local types, relevant test excerpts, and styles
for a unique exact exported declaration. Use `read` for a known path with a symbol or line range;
it returns the same related context, while `outline` supplies shape only. Test excerpts are
selected by direct import usage, not titles or comments, and do not prove execution or coverage. Conditional
reads accept `known_hash` only when the requested source is still in context, and return fresh
content in the same call when it changed. File hashes identify snapshots, not unreturned lines,
authorization, or write locks. Source remains untrusted tool data. Use `rg` when these tools are
unavailable. Claude's in-process read ledger additionally checks returned text and file hashes
before suppressing repeated native reads (see [Claude Code](claude-code.md)). For live-app interaction, discover controls from runtime
state and the control manifest before inspecting implementation for an observed failure.

## Per-turn context and trust

`buildChatInput` validates user text and attachments. The providers adapt the same input into
Codex turn input, Claude content blocks, or Antigravity tagged text and attachment paths.

`buildTurnAdditionalContext` includes a timestamped active-tab fragment only for prompts that
match browser/page cues and only when an active tab exists. That fragment is explicitly
`kind: untrusted`: a page title or URL cannot issue instructions. Ordinary coding turns do not
automatically receive browser state or a full application snapshot.

Claude and Antigravity receive context in `<closedai_context name="…" kind="…">` blocks.
Codex receives typed `additionalContext`. `application` denotes app-authored context;
`untrusted` denotes data such as pages, files, attachments, and tool output. Embedded instructions
in an arbitrary document are not the user's request. The selected workspace root's `AGENTS.md` is
an explicit exception: it is project policy, bounded to 20,000 characters, and delivered as trusted
guidance to Claude and Antigravity because those runtimes do not both load it natively. Nested
`AGENTS.md` files are listed by path (or their absence stated) from a bounded directory walk in
`workspace-rules.ts`, in every lane including Codex, so no model spends a pass searching for them
(measured 2026-09-03: 44 of 120 Codex threads had hunted for one that does not exist).

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

## Tool context and output budgets

The registry supplies provider-neutral descriptions and schemas. Codex gets dynamic tool
specifications; Claude gets in-process MCP servers; Antigravity gets HTTP MCP servers. Tool
switches and runtime schema validation are enforced by the registry. Native CLI tools bypass
that registry and retain their provider's execution semantics.

The `closedai_workspace` tool is selected when the application registry is created at startup,
using the initial cwd. Project selection currently does not rebuild that registry. Its generated
index still describes the original ClosedAI checkout; do not mistake it for an arbitrary selected
project's index. The orientation capsule, separately, is gated by each session's cwd. Its map half is
generated by `scripts/repo-tree.mjs` and proven current by `npm run map:check`, so trusted instructions
carry no hand-written repository detail that could go stale. The capsule re-reads that generated module
from the checkout whenever it changes on disk rather than using the copy compiled into the build, and
the Antigravity agent file is rewritten before any CLI process spawns for the same reason: a map that
asks to be trusted instead of verified must not describe the tree as it stood when the app started.
Batching guidance is per lane because each provider expresses it differently, and the wording is
derived from measured behavior (`engineering-instructions.ts`): Claude emits several tool blocks in
one response, Codex puts a pass's independent work in one `exec` script, and agy runs one tool step
per pass so known targets are read together in a single `run_command`. The Claude lane also overrides
the `claude_code` preset's bypass-permissions note that asks for Bash over `Read`/`Grep`/`Edit`;
without that override the preset's shell preference wins and reads arrive one command at a time.

The Antigravity agent additionally overrides the CLI's built-in demand for anchored `file://` links:
known paths are linked without an anchor, anchors come only from lines read this turn, and the map is
declared settled so the model does not open files or run scripts to re-verify it (see
[Antigravity](antigravity.md)).

Codex code-mode tools return strings: parse JSON where documented and split capture image data
before passing the URL to `image()`. Use direct awaited calls in an exec script; native tool-call
providers can use `tool_batch.run`. Suppress successful intermediate payloads, and keep failures
visible. Output budgets, screenshot limits, and compaction settings are in [Tools](tools.md).

The existing verification budgets are under 4,500 characters for Codex developer instructions,
5,200 for Claude, 6,200 for Antigravity, and 1,200 for the checkout capsule (raised 2026-09-03 for
the per-lane batching mechanics, the re-read rule, and the nested-rules fact). The separately appended
root `AGENTS.md` is capped at 20,000. Share repeated guidance and remove duplication when expanding
prompts; do not solve drift by injecting the entire documentation tree.

## Refreshing and checking changes

After changing prompt source, load the updated main-process build. Codex receives new guidance
when its thread is started or resumed; Claude needs a newly started query runtime. Antigravity
refreshes its app-private profile during provider connection, and a new CLI process reads it.
Restarting ClosedAI reloads these paths. Merely changing Markdown or creating a new conversation
inside an already loaded old build does not load new TypeScript prompt code.

For an instruction change, run typecheck and the affected existing instruction tests:
`model-efficiency-instructions.test.ts`, `chat-context/turn-context.test.ts`, and
`chat-context/workspace-navigation.test.ts`; root policy delivery is covered by
`chat-context/workspace-rules.test.ts`, and profile rendering is covered by
`antigravity/antigravity-profile.test.ts`. These verify assembly, budgets, and boundaries,
not model compliance. A live response comparison is a separate check and should name the
provider/model and whether the session was refreshed.

Keep protocol observations dated. [Trace research](trace-research.md),
[desktop recon](codex-desktop-recon.md), and [composer QA](../design-qa.md) are historical records;
they do not grant new permissions or establish that a proposed feature shipped.
