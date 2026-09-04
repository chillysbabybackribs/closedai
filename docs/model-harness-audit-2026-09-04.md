# Model harness audit and rebuild

Reviewed 2026-09-04. Scope: the instructions supplied to all four model providers, tool
advertising and dispatch, Claude native-read interception, workspace orientation, and batch
completion. This is a source audit and local regression verification, not a comparative model
benchmark. Provider base prompts and model weights are outside this repository.

## Findings and changes

| Finding | Evidence in the original implementation | Change |
|---|---|---|
| Overlapping process rules made batching a task in itself. | `application-instructions.ts` required every independent browser operation to be batched; `engineering-instructions.ts` called model passes the unit of cost and required every known read in one pass; `product-instructions.ts` separately required decisions around state changes. | One batching policy in `product-instructions.ts`: group independent reads when useful, inspect results before dependent decisions, and pair temporary state with release. Ordinary direct calls are allowed. Real-input verification still applies. |
| Browser routing contradicted itself. | Shared instructions preferred page/network/session tools; `browser_cdp.protocol` advertised itself as the primary browser interface and the first surface for virtually every task. | Page/network/session tools are the first path. Raw CDP is an advanced fallback. Protocol, profile, instrument, and emulate are deferred where supported. Existing names and call contracts remain available. |
| Native file reads were intercepted by a second memory system. | `ClaudeReadLedger` installed six SDK hook categories, reread files to hash/compare them, tracked ranges and pending calls, denied repeats, rewrote requested ranges, and injected receipts. | Removed the ledger, its session/service wiring, and its obsolete tests. Claude's native tools now run through the SDK without app read interception. Shared workspace reads still support explicit conditional fetching. |
| A partially failed plan was reported as success. | `batch/index.ts` set `isError` only when zero calls succeeded. A successful first call followed by failure and skipped work therefore returned success. | Any failed/skipped call returns an error while preserving successful evidence and per-call status. Guidance says to recover only failed work, preventing blind replay of successful mutations. |
| Response instructions over-prescribed wording. | Global first-person phrase bans and a requirement to disclose every recovered tool error added reporting obligations to every task. | One concise style instruction: direct answers, useful progress, relevant verification and limitations, and errors that affect the result. |
| Verification instructions could prevent necessary checks. | “Skip pre-change baselines” and “typecheck once” were unconditional, regardless of task or later edits. | Repository rules take precedence; focused checks can repeat after failures or subsequent edits. |
| Orientation and tests had drifted. | The injected checkout capsule measured 5,515 characters against a 5,000 limit. A generated control-owner test assumed `project-menu.tsx` was always the first owner. Prompt tests also demanded wording explicitly forbidden by another prompt test. | Removed duplicate orientation prose, preserved the existing limits, made owner checks independent of ordering, and tested shared assembly and the revised contracts. |
| A browser tool misstated its effects. | The `embedded_browser.page` preamble said “Read-only” even though navigate, evaluate, and fetch can change state. | The description names those effects explicitly. This corrects the model-facing claim; it does not turn the existing multi-action tool into a read-only capability. |

## Resulting process

1. The provider owns its native conversation, file tools, and model execution.
2. ClosedAI supplies a shared product contract and only the adapter-specific instructions needed
   for tool names, context transport, and the visible browser.
3. The model chooses the next operation from the task and current evidence. Independent reads
   may overlap; a dependent decision waits for its evidence. Routine work does not need a batch
   plan or a checkpoint.
4. App tools go through the existing registry for validation, switches, timeouts, cancellation,
   resource coordination, output budgets, and trace/telemetry. No second dispatcher was added.
5. A failed batch is a failed batch. Results identify completed, failed, and skipped calls so
   recovery can target the right operation. Existing sequential cleanup remains responsible for
   temporary instrumentation on failure.
6. The model verifies the change according to repository/task requirements and gives the user
   the result and any material limitation.

Tool-specific procedures belong in the owning tool's description. Shared instructions should
not repeat its action list or impose its workflow on unrelated tasks. Provider adapters translate
the shared contract; they should not implement another file-read policy or working-memory system.

## Measurements

Builder output measured with cwd `/outside-index`, excluding project AGENTS policy and checkout
orientation. These are JavaScript string lengths, not token counts or latency measurements.

| Provider | Before | After | Reduction |
|---|---:|---:|---:|
| Codex | 6,969 | 4,261 | 39% |
| Claude | 7,818 | 4,507 | 42% |
| Antigravity | 8,907 | 4,966 | 44% |
| Cursor | 7,735 | 4,360 | 44% |

The eager CDP description/schema surface falls from 19,421 to 5,520 serialized characters
on providers honoring deferred discovery. Four advanced tools remain discoverable; this is
not removal of their capabilities. Other providers still receive their definitions.

The deleted ledger comprised 187 implementation lines and 148 test lines, plus removed wiring.
The checkout capsule fits its unchanged 5,000-character budget after removing duplicate prose.

## Verification and limits

Required local checks: typecheck, hygiene, regenerated workspace index and `map:check`, and the
affected prompt, context, provider-options, tool-adapter, CDP, browser, and batch regression tests.
Runtime tests cover sequential failure/skipping, partial-result preservation, independent parallel
work, same-target serialization, cancellation, real-input validation, and compensation. Prompt
tests establish assembly and budgets; they cannot establish model compliance.

No provider session was restarted and no live model quality or latency comparison was performed.
Existing sessions need refreshed runtime instructions to use this rebuild. A smaller prompt alone
does not prove a faster or better response.

The next live comparison should use the same model and effort on the same three tasks: a small
code change with a requested reread; a browser lookup followed by a signed-in API operation; and
a sequence with one failed action after one successful mutation. Check correctness, unnecessary
tool passes, recovery without replaying successful mutations, and time to useful output. Use the
existing Turn Trace rather than adding another evaluation service.

Existing architecture limits remain visible: multi-action schemas still combine fields and some
read/mutation operations; the workspace namespace is registered for the startup checkout; app
source-version observations still add bounded work before Send; and protocol-specific session and
compaction behavior still differs. Those are separate migrations with their own compatibility and
runtime evidence requirements, not behavior this audit claims to have fixed.
