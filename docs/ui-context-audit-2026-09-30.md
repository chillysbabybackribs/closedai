# Workspace UI and provider context audit

Reviewed September 30, 2026 against the checkout starting at `c40f8809`, with live Electron
verification of the repairs described below. This is dated engineering evidence, not a new
model instruction or a replacement for the current application and context guides.

The reported dead Chats launcher was a state-management defect: launching a window required
an existing chat tile. The wider review found incompatible assumptions about empty workspaces
and substantial differences between Cursor's session continuity and the other adapters.
Those differences are credible quality risks, but this audit does not establish that they caused
a particular model's incorrect edit. No controlled cross-provider quality experiment was run.

## Scope and evidence

The source review followed dock actions through App, DesktopWorkspace, the layout controller,
tree operations, floating windows, notepad placement, backend visibility and chat creation.
It also reviewed provider input construction, Codex catalog refresh, Cursor session policy,
Claude options, common guide delivery, handoff construction, rotation defaults, workspace ledger,
tool slicing, trace retention, telemetry, and the model/UI harnesses.

Evidence consists of source inspection, deterministic counterexamples, focused tests, a full
application build, and real Electron controls/state/captures. This is not an exhaustive audit of
every subsystem, every screen size, security, browser internals, or all model responses. Dated
QA entries and the coverage ledger are treated as historical records, not current passing tests.

## Repairs made

| Defect | Cause | Repair and evidence |
| --- | --- | --- |
| Chats does nothing after all content windows close | `newChatWindow` returned when no chat tile could be its host | Creation now accepts no host; main already supports `newPeer()` using the selected chat. Verified in Electron from zero visible chats, zero views and a hidden browser. |
| Chats cannot launch from a view-only layout | The same guard treated a view tile as insufficient | Chat creation and geometric placement are independent. Verified with Notes as the only window. |
| Notes cannot open from a browser-only tree | `openNoteInTree` also required a non-browser host | Chats and Notes share `tabInNewWindow`; a first content window tiles without revealing a hidden browser. Tested and exercised live. |
| Floating fallback restores a minimized host | Add-tab, tear-off, reselect-host temporarily mutated the existing window | Direct insertion preserves existing windows, tabs, and minimized state. Regression tests cover minimized and view-only hosts. |
| A floating new window can remain hidden by maximization | `openWindowIn` cleared maximization only when auto-placement tiled | Opening a changed window now clears maximization for either placement. Source-verified; not separately exercised live. |
| Main retains old visibility after the last content window closes | The reporting effect skipped an empty tree | Visibility is reported even without content tiles; lists can be empty when no side chats remain. Main accepts empty arrays. |
| Closing the selected chat can try selecting a Notes/view id | `hide` chose `paneIds(remaining)[0]` as a backend chat id | It now chooses a visible chat id, or retains the backend selection with adoption suppressed. Verified live with Notes remaining. |
| Opening a view can allow the last closed chat to reappear | The suppression guard applied only while there were no content tiles | Suppression persists until an explicit activation or a different selection. Verified by opening Notes and then opening/closing a new chat. |

Sources: [layout controller](../src/renderer/chat-layout/layout-controller.ts),
[window insertion](../src/renderer/chat-layout/floating/window-layout.ts),
[notepad layout](../src/renderer/notepad/notepad-layout.ts),
[backend peer manager](../src/main/chat-peers/peer-manager.ts).
No provider runtime policy or user settings were changed by these repairs.

## Remaining UI findings

**High priority: empty is still not a consistent saved state.** `initialWindowTree` interprets a
saved browser-only tree as a missing layout and restores the selected chat or a History view.
A direct probe with a saved browser leaf and selected chat `a` returned a new pane for `a`.
An Electron renderer rebuild during this audit also reopened the selected chat. An intentionally
empty layout needs to be distinguished from no saved layout and from an invalid pruned layout.
See [layout-windows](../src/renderer/chat-layout/layout-windows.ts).

**High priority: all-minimized can be undone by reconciliation.** `setGroupDocked` permits every
window to minimize, but `ensureExpandedGroup` still restores a candidate when none is expanded.
The controller invokes it during pruning and removal. A direct probe of one minimized chat plus
the browser returned `docked: false`. The initial prune effect can run even without a removed
chat. The newer empty-workspace contract and the older normalization contract disagree.
See [layout-docking](../src/renderer/chat-layout/layout-docking.ts) and its controller callers.

**Medium priority: close depends on which control is used.** The window close button permits
closing the last content window. `focusedCloseAction` returns null for its last tab; tab close
visibility and `closeTab` retain similar last-pane guards. A direct probe of the last chat plus
browser returned no keyboard close action. Decide whether closing a sole tab should close its
window, then make keyboard, tab, context-menu and window actions follow that one decision.
See [layout-tabs](../src/renderer/chat-layout/layout-tabs.ts),
[pane header](../src/renderer/chat-layout/chat-layout-pane-header.tsx), and the controller.

**Medium priority: detached adoption assumes a destination tile.** `adoptTabs` returns the old
tree when there is no non-browser tile. A return-to-main-window operation therefore needs an
explicit empty-workspace case. This is source evidence; the detached-window round trip was not
exercised live in this audit. See [layout-windows](../src/renderer/chat-layout/layout-windows.ts).

**Structural diagnosis.** The layout controller currently coordinates backend selection,
optimistic creation, visibility reporting, persistence, windows, views, quick chats, and drag
placement. At 691 lines it slightly exceeds the advisory threshold, but size is not the defect.
The defect is duplicated transition policy across guards, effects and helpers. The insertion fix
reuses the existing window module and removes duplicated Notes logic; no new abstraction was
needed for it. The next useful extraction is a pure transition model for close, activate,
minimize, restore, launch and reconcile. Keep IPC effects in the controller. Do not split the file
solely to reduce its line count.

## Provider differences confirmed in source

| Dimension | Cursor | Codex | Claude and Antigravity |
| --- | --- | --- | --- |
| Routine session lifetime | Native session retained; explicit Compact can rotate | App idle rotation plus catalog-change rotation | App rotation supported; Claude disables native auto-compaction when seamless rotation is enabled |
| Tool slicing | Slice recorded for telemetry; all enabled MCP namespaces remain attached | Eager/deferred advertisement changes can change the catalog and replace the thread | Eager configuration changes retire the idle provider process; this is not itself proof of a new conversation id |
| Session guide | Not injected | First new thread/handoff | First new session/handoff, serialized as tagged user text |
| Workspace ledger | Not injected | Conditional injection | Conditional injection |
| Clock and runtime facts | Every turn | Every turn | Every turn |
| Context transport | Tagged text before the request | Typed additional context beside native input | Tagged text before the request |
| Project policy | Native provider mechanisms | Native AGENTS.md support | Claude loads project/user settings and its native CLAUDE.md conventions; the app does not copy AGENTS.md into either lane |

Sources: [Cursor service](../src/main/cursor/cursor-service.ts),
[Cursor thread lifecycle](../src/main/cursor/cursor-thread-lifecycle.ts),
[Codex thread lifecycle](../src/main/chat-service-thread-lifecycle.ts),
[Claude options](../src/main/claude/claude-options.ts),
[provider tool attachment](../src/main/tools/provider-tool-slice-turn.ts), and
[session guide construction](../src/main/chat-context/session-guide.ts).
These are application-side facts; provider-internal reasoning and discovery are not observable here.

### Continuity is the first quality variable to isolate

**Confirmed:** defaults enable seamless rotation, an 80 percent context threshold and a
100-transcript-item threshold. The absolute token threshold defaults to zero. Item pressure can
therefore trigger a rotation before the percentage threshold. Cursor has no corresponding
automatic rotation. See [settings defaults](../src/main/app-settings-store.ts),
[rotation pressure](../src/main/chat-context/rotation-pressure.ts), and
[session rotation](../src/main/chat-context/session-rotation.ts).

**Confirmed:** Codex catalog refresh is independent of the seamless-rotation preference.
`ensureCodexThread` compares the catalog and rotates on a difference. Tests explicitly verify
that changing task slices replaces the thread. Turning off idle rotation alone does not create
a stable-session comparison.

**Confirmed:** the browser slice wins when the supplied surface has a nonblank URL, even if the
prompt is “Fix the unit test.” A direct probe selects `core` without that surface and `browser`
with it. The browser metadata injector has stricter intent filtering than the slice selector.
Thus tool preparation can still be affected by unrelated browser state even when no ambient
page metadata enters the request. See [slice selection](../src/main/tools/tool-slice-select.ts).

**Confirmed:** rotation handoffs preserve complete user requests and the latest answer/plan,
subject to their selection rules, with a 24,000-character soft target. They omit prior raw tool
output, reasoning and screenshots, and point to recall for evidence. The visible transcript can
therefore look continuous while the model's immediate evidence is discontinuous. See
[handoff construction](../src/main/chat-context/thread-handoff.ts).

**Hypothesis:** avoidable rotations and omitted working evidence contribute to repeated
investigation, missed constraints, and edits based on summaries. This is a plausible mechanism,
not a measured explanation for Cursor's perceived advantage. Older user requests are preserved;
claiming that rotation simply deletes the user's instructions would be inaccurate.

### More instructions do not establish parity

The session guide and shared ledger add context to the non-Cursor lanes that Cursor does not
receive. The guide can help orientation, but its net quality effect has not been measured here.
The ledger records host-hashed paths, not correctness of an edit; shell edits and provider event
formats can also affect what gets recorded. Its test parser records a matching test path rather
than proving the entire application. See [ledger runtime](../src/main/chat-context/workspace-ledger/runtime.ts).

This checkout has AGENTS.md and no discovered CLAUDE.md or .cursorrules. The guide does not
automatically make native policy loading equivalent. Conversely, local or parent-directory
provider settings may exist; this review does not claim they are absent. Cross-provider
comparisons must record effective instructions and skills, not assume equal policy from equal cwd.

Antigravity's input adapter lists images as materialized file paths, while Claude and supported
Cursor sessions can receive image content blocks. That is another observable difference for
visual-edit tasks, without evidence here that it explains an error. See the three providers'
`*-input.ts` modules.

## Verification and measurement gaps

The UI coverage command reported 309 jobs: 15 pass, 5 fail, 4 skip, and 285 remaining. Those
are stored ledger statuses, not current results from rerunning 309 controls. Some failure notes
explicitly say fixes have not been retested. Control coverage also does not prove transitions
such as close-all → launch, minimize-all → reload, or view-only → close-selected-chat.

The automated model harness supports `golden` and `codex`, not a four-provider comparison.
`harness:live` prints task instructions; it does not execute and grade a live provider matrix.
`resolveModelAdapter` can fall back from Codex to golden replay when the binary is unavailable,
and the CLI defaults to golden unless selected. Reports must distinguish replay from live model
evidence. See [model runner](../src/main/harness/model-run.ts) and
[live task command](../scripts/harness-sim/live-eval.mjs).

Tool telemetry persists aggregate counters without provider/model/task identity. Turn Trace is
an in-memory bounded ring, and most non-turn entries are recorded only when tracing is active.
These mechanisms cannot retrospectively establish which provider misread a request or whether
a failed call recovered. See [telemetry](../src/main/tools/telemetry.ts) and
[trace log](../src/main/trace/trace-log.ts). Do not treat aggregate tool failures as model scores.

The focused provider run initially failed an unchanged-catalog test because its mock used an
unsliced catalog while the default enables slicing. The fixture now seeds the catalog through
the production resolver. All five lifecycle tests pass; no runtime policy was changed to make
the test pass.

## Recommended work order

1. Make empty, view-only, all-minimized and browser-only layouts explicit supported states.
   Unify close/restore/reconcile/persist policy and test complete transitions. Preserve background
   tasks and history independently of visible windows. Add detached return and multi-space cases.
2. Establish a stable-session quality baseline. In isolated profiles, compare each lane's current
   defaults against slicing off and automatic rotation off; confirm actual thread ids and catalog
   fingerprints remain stable. For Claude, this restores native auto-compaction, so record that
   behavior rather than calling it “no compaction.” Leave the normal user profile unchanged.
3. Hold prompts, starting commit, available tools, browser state and task grading fixed. Match
   model and effort where the provider supports them; compare each provider to its own baseline
   as well as Cursor. Run repeated trials, not one anecdotal answer.
4. Cover a small edit with an unrelated file to preserve; empty-canvas launch repair; a follow-up
   correction; an interrupted task resumed after rotation; and a screenshot-based placement task.
   Grade correctness, unwanted edits, constraint retention, evidence behind completion claims,
   regression checks, and unnecessary user clarification. Measure latency separately.
5. Ablate guide and ledger separately after continuity is controlled. Record native policy and
   effective schemas. Prefer reducing demonstrated friction to adding another instruction layer.
6. Add bounded diagnostic provenance: provider/model/effort, build revision, catalog fingerprint,
   context fragment names and sizes, rotation reason, and task outcome. Avoid recording raw
   sensitive prompts/results merely to get these dimensions.

The highest-value follow-up is the transition-policy cleanup plus a reproducible provider
comparison. Cosmetic reorganization alone cannot resolve the state contradictions, and this
audit does not justify declaring any underlying model intrinsically unreliable.

## Checks performed

- Full `npm run build` passed, including TypeScript and architectural hygiene. Existing Vite
  mixed static/dynamic import advisory remains nonblocking.
- Eighteen window/notepad tests passed, including new empty, view-only and minimized-host cases.
- Fifty focused layout/provider/context tests are passing across the audit runs after correcting
  the five-test lifecycle fixture. The initial failure and its reason are recorded above.
- Real Electron verified empty canvas → Chats, empty canvas → Notes, Notes-only → Chats, and
  closing the selected chat while Notes remains. The browser stayed hidden. No model message
  was sent to the temporary test chats. The final changed surface was captured after rebuild.
- Workspace map regeneration, `map:check`, `guide:check`, and tracked/untracked whitespace checks passed.
- The pure counterexamples above demonstrate remaining inconsistent policies; they are findings,
  not claims that those behaviors were fixed.

No full-suite release gate or paid cross-provider benchmark was run. The live checks establish
the repaired paths, not an all-clear for every UI state or provider quality.
