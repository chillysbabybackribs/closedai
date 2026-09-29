# Docs and tool-telemetry audit reports

Timestamped markdown reports from the report-only auditor (no automatic doc edits).

**Run:** `npm run audit:docs`

Optional telemetry path (defaults to `~/.config/closedai/tool-telemetry.json`):

```sh
npm run audit:docs -- --telemetry=/path/to/tool-telemetry.json
```

Each run writes `docs-telemetry-audit-<ISO-timestamp>.md` in this directory.

## Model usability review — first pass (2026-09-29)

Scope: current source and guides for model context, tool use, conversation retrieval, and tool
diagnostics. This is a qualitative first pass, not a full provider-by-provider study. Telemetry
figures below are one local snapshot from
[`docs-telemetry-audit-2026-09-29T22-27-07-597Z.md`](docs-telemetry-audit-2026-09-29T22-27-07-597Z.md).

### Changes made

- Expanded the generated session guide's chat retrieval instruction into a concrete workflow:
  open pane → `list(open)` → `read`; prior conversation → `list(history)` for metadata →
  `recall(history)` for message and tool text. It names the paging fields and notes that history
  order follows user submissions, which may differ from the UI's activity order.
- Source: `scripts/agent-guide-outline.json`; generated output:
  `src/main/chat-context/agent-guide.generated.ts`.

### Findings

1. **Cross-chat retrieval is capable but easy to misuse (high confidence).**
   `peer_chats.list(scope=history)` searches titles, previews, project paths, and checkpoint notes;
   it does not search transcript text. Models must select a returned `chatId` and call
   `peer_chats.recall(scope=history, chat_id=...)` for message/tool evidence. Open-chat `read`
   does not read closed history. The tools guide had these details, but the old cold-start instruction
   named both tools without explaining their different roles. The telemetry snapshot recorded
   11 misuses in 72 `peer_chats.list` calls; this is evidence of friction, not proof of one cause.

2. **Aggregate telemetry cannot show whether a recovery worked (high confidence).**
   Tool telemetry persists per-tool/action counts, timestamps, and up to three short failure notes
   per tool. It deliberately stores no arguments, results, durations, provider/model identity, chat
   id, or retry linkage. Maintainers therefore cannot tell whether a failure was transient, whether
   the model corrected its call, or which provider/schema combination needs help. The local snapshot
   reported 104 failures among 387 `tool_batch.run` calls (22 misuses), and 11 among 72
   `peer_chats.list` calls (all 11 misuses). These totals locate candidates for investigation; they do
   not identify causes or task impact.

   **Candidate improvement:** add opt-in, content-free dimensions such as provider/model family,
   call duration, schema/catalog revision, and a short-lived correlation between a refused call and
   its retry outcome. Keep arguments and results out. Establish a baseline and check cardinality,
   retention, and provider availability before changing the persisted schema.

3. **The richest debugging evidence is temporary and sensitive (high confidence).** Turn Trace can
   show tool arguments/results and raw provider protocol lines, but is an in-memory ring that clears
   at restart. This helps inspect live failures while avoiding durable transcripts; incidents found
   later may have no evidence. Persisting the trace wholesale would retain sensitive content and is
   not a suitable default.

   **Candidate improvement:** consider a user-triggered diagnostic bundle with a preview, explicit
   redaction, bounded time window, and content-free telemetry by default. Design any model-readable
   export separately from the live trace.

4. **“Most recent” means different things across history surfaces (medium confidence).** The UI
   ranks records by last turn completion (falling back to store update), while
   `peer_chats.list(scope=history)` ranks by last user submission. Background completion and pinning
   do not affect the latter. Both are reasonable, but a model looking for “the latest chat” can select
   a different record from the user-facing history. The guide now states the tool's ordering; the
   application guide documents the UI's ordering.

   **Candidate improvement:** preserve both timestamps in history results with explicit labels, so
   models can choose “latest started” versus “latest completed” without inferring from one timestamp.

5. **Tool-catalog size remains uneven across provider lanes (medium confidence).** Codex defers
   most tool schemas until discovery, while Cursor and Antigravity expose enabled schemas for the
   session. The generated guide says that disabling unused groups reduces catalog size for those
   providers. This is a token-budget difference; this pass has no evidence that measures its effect
   on tool selection or answer quality.

   **Candidate improvement:** measure advertised schema tokens and tool-use outcomes by provider,
   then consider narrower catalog exposure only where those measurements show a cost.

### Limits and next review

- Telemetry counts are one local snapshot with no task-level denominator. Do not treat them as
  provider quality scores or infer a defect from a high failure rate without checking examples and
  retries.
- This pass did not run live tasks against each provider, inspect private user transcripts, or change
  runtime telemetry behavior.
- Next useful step: repeat a small, privacy-safe task set covering closed-chat discovery, evidence
  paging, one recoverable tool refusal, and batch stop/continue behavior. Record provider, schema,
  duration, and task completion without retaining prompt or result text.
