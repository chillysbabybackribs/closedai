# Model usability review — first pass

Date: 2026-09-29

Scope: current source and guides for model context, tool use, conversation retrieval, and
tool diagnostics. This is a qualitative first pass, not a full provider-by-provider usability
study. The telemetry figures below are one local snapshot from
`docs/reports/docs-telemetry-audit-2026-09-29T22-27-07-597Z.md`.

## Changes made

- Expanded the generated session guide's chat retrieval instruction into a concrete workflow:
  open pane → `list(open)` → `read`; prior conversation → `list(history)` for metadata →
  `recall(history)` for message and tool text. It also names the paging fields and notes that
  history order follows user submissions, which may differ from the UI's activity order.
- Source: `scripts/agent-guide-outline.json`; generated output: `src/main/chat-context/guide.generated.ts`.

## Findings

### 1. Cross-chat retrieval is capable but easy to misuse — high confidence

`peer_chats.list(scope=history)` searches titles, previews, project paths, and checkpoint notes;
it does not search transcript text. Models must select a returned `chatId` and call
`peer_chats.recall(scope=history, chat_id=...)` for message/tool evidence. Open-chat `read`
does not read closed history. The tools guide had these details, but the old cold-start instruction
named both tools without explaining their different roles. The telemetry snapshot recorded
11 misuses in 72 `peer_chats.list` calls; this is evidence of friction, not proof that every refusal
came from the same confusion.

**First action:** the generated session guide now gives the workflow. Review future misuse counts
and notes to see whether this reduces wrong-scope calls.

### 2. Aggregate telemetry cannot show whether a recovery worked — high confidence

Tool telemetry persists counts by tool/action, timestamps, and up to three short failure notes per
tool. It deliberately stores no arguments, results, durations, provider/model identity, chat id, or
retry linkage. That keeps the file small and avoids conversation retention, but maintainers cannot
tell from this data whether a failure was transient, whether the model corrected its call, or which
provider/schema combination needs help. The local audit snapshot reported 104 failures among 387
`tool_batch.run` calls (22 misuses), and 11 among 72 `peer_chats.list` calls (all 11 misuses).
Those totals locate candidates for investigation; they do not identify causes or task impact.

**Candidate improvement:** add opt-in, content-free diagnostic dimensions such as provider/model
family, call duration, schema/catalog revision, and a short-lived correlation between a refused call
and its retry outcome. Keep arguments and results out. Establish a baseline and check cardinality,
retention, and provider availability before changing the persisted schema.

### 3. The richest debugging evidence is temporary and sensitive — high confidence

Turn Trace can show tool arguments/results and raw provider protocol lines, but is an in-memory ring
that clears at restart. This helps inspect a live failure while avoiding durable transcripts, yet
incidents discovered later may have no diagnostic evidence. Persisting the trace wholesale would
retain sensitive content and is not a suitable default.

**Candidate improvement:** consider a user-triggered diagnostic bundle with a preview, explicit
redaction, bounded time window, and content-free telemetry by default. A model-readable export
should be designed separately from the live trace rather than silently persisting its contents.

### 4. “Most recent” means different things across history surfaces — medium confidence

The UI's chat history ranks records by last turn completion (falling back to store update), while
`peer_chats.list(scope=history)` ranks by last user submission. Background completion and pinning
do not affect the latter. Both are reasonable for their use, but a model looking for “the latest
chat” can select a different record from the user-facing history. The guide now states the tool's
ordering; the application guide documents the UI's ordering.

**Candidate improvement:** preserve both timestamps in history results with explicit labels, so
models can choose “latest started” versus “latest completed” without inferring from one timestamp.

### 5. Tool-catalog size remains uneven across provider lanes — medium confidence

Codex defers most tool schemas until discovery, while Cursor and Antigravity expose their enabled
schemas for the session. The generated guide already says that disabling unused groups reduces
catalog size for those providers. This is a real token-budget difference, but no current evidence
here measures its effect on tool selection or answer quality.

**Candidate improvement:** measure advertised schema tokens and tool-use outcomes by provider,
then consider narrower catalog exposure only where those measurements show a cost.

## Limits and next review

- Telemetry counts are a single local snapshot with no task-level denominator. Do not compare them
  as provider quality scores or infer that a high failure rate is a tool defect without reading
  examples and checking retries.
- This pass did not run live tasks against each provider, inspect private user transcripts, or change
  runtime telemetry behavior.
- Next useful step: repeat a small, privacy-safe task set covering closed-chat discovery, evidence
  paging, one recoverable tool refusal, and batch stop/continue behavior; record provider, schema,
  duration, and whether the task completed without retaining prompt or result text.
