# Model context and instructions

Source review: 2026-09-03. Common product facts, provider-specific rules, runtime context, and
repository documentation have separate owners. Editing a Markdown guide alone does not change
every running model's prompt.

## Instruction assembly

| Layer | Owner | Delivery |
|---|---|---|
| Common product facts and tool routing | `src/main/chat-context/application-instructions.ts` | Included by all three provider instruction builders |
| Response style | `src/main/chat-context/articulation-instructions.ts` | Included by all three builders; outcome-first responses and meaningful updates without first-person work narration |
| Codex adapter guidance | `src/main/chat-context/developer-instructions.ts`, `thread-params.ts` | `developerInstructions` on thread start and resume, alongside Codex's base instructions |
| Claude adapter guidance | `src/main/claude/claude-instructions.ts`, `claude-options.ts` | Appended to the SDK's `claude_code` system preset when a query runtime starts |
| Antigravity adapter guidance | `src/main/antigravity/antigravity-instructions.ts`, `antigravity-profile.ts` | Written to the app-private `agent.md`; loaded through `--agent closedai` and `--add-dir` on CLI startup |
| Checkout orientation | `src/main/chat-context/workspace-navigation.ts` | App-authored prose plus the generated repository map from `workspace-map.ts`, only when the session cwd matches `WORKSPACE_INDEX_ROOT` |
| Repository rules | `AGENTS.md`, applicable `CLAUDE.md` | Provider-native discovery where supported, plus instruction to follow applicable workspace rules |

The common product facts explain separate chat panes, their shared browser, and the distinction
between pane turns and provider background work. App facts come from `closedai_app.state`,
service operations from `closedai_app.command`, and real renderer interaction from manifest
control ids through `closedai_app.ui`. Other panes are readable through `peer_chats`.
Browser pages use the CDP tools described in [Tools](tools.md) and [CDP](cdp-tool-foundation.md).

The shared response style asks for results and evidence, with progress only when it adds a new
result, blocker, or required choice. It discourages “I have…”, “I am…”, and “I will…” work logs.
It is prompt guidance, not a text filter or a guarantee of identical output across models.
Quoted user text and historical transcripts are not rewritten.

The checkout capsule links [Application](application.md), this guide, and [Tools](tools.md).
It does not inline their full contents. Models retrieve the relevant document or source when
needed. `closedai_workspace.inspect find` and `outline` provide focused source navigation;
use `rg` when that tool is unavailable. For live-app interaction, discover controls from runtime
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
in a document are not the user's request. Applicable repository engineering instructions are
handled through the workspace instruction policy, not promoted from arbitrary tool output.

`closedai.chat.handoff` carries a locally assembled digest when continuing/branching a chat.
It is app-authored (`application`) but includes historical conversation text. Treat quoted
requests and answers as history, not fresh authorization; re-read files for exact state. The
digest is limited to about 12,000 characters, with individual entries clipped to 1,500 and at
most 30 changed-file paths. Attachments contribute names, not their image bytes. The current
formatter labels assistant entries “Codex” across providers; that label is not reliable proof
of which provider produced the original answer.

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

Codex code-mode tools return strings: parse JSON where documented and split capture image data
before passing the URL to `image()`. Use direct awaited calls in an exec script; native tool-call
providers can use `tool_batch.run`. Suppress successful intermediate payloads, and keep failures
visible. Output budgets, screenshot limits, and compaction settings are in [Tools](tools.md).

The existing verification budgets are under 3,500 characters for Codex developer instructions
and under 1,200 for the checkout capsule. Share repeated guidance and remove duplication when
expanding prompts; do not solve drift by injecting the entire documentation tree.

## Refreshing and checking changes

After changing prompt source, load the updated main-process build. Codex receives new guidance
when its thread is started or resumed; Claude needs a newly started query runtime. Antigravity
refreshes its app-private profile during provider connection, and a new CLI process reads it.
Restarting ClosedAI reloads these paths. Merely changing Markdown or creating a new conversation
inside an already loaded old build does not load new TypeScript prompt code.

For an instruction change, run typecheck and the affected existing instruction tests:
`model-efficiency-instructions.test.ts`, `chat-context/turn-context.test.ts`, and
`chat-context/workspace-navigation.test.ts`; profile rendering is covered by
`antigravity/antigravity-profile.test.ts`. These verify assembly, budgets, and boundaries,
not model compliance. A live response comparison is a separate check and should name the
provider/model and whether the session was refreshed.

Keep protocol observations dated. [Trace research](trace-research.md),
[desktop recon](codex-desktop-recon.md), and [composer QA](../design-qa.md) are historical records;
they do not grant new permissions or establish that a proposed feature shipped.
