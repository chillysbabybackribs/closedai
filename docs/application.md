# Application guide

Source review: 2026-09-03, including the current uncommitted changes. This describes implemented
behavior, not a new live UI or provider verification. Protocol measurements retain their dates
in the provider guides.

## Projects, panes, and conversations

`ChatPeerManager` owns the active project's open chat panes. Each pane has its own `ChatHub`,
provider settings, and conversation state; only the selected pane is displayed. A background
pane can continue its turn while another pane is selected. The embedded browser belongs to the
application and is shared across panes and project switches.

`ChatHub` routes to Codex, Claude Code, or Antigravity. Codex model/thread ids are unprefixed;
Claude ids use `claude:` and Antigravity ids use `agy:`. Changing provider rebinds the pane to the
destination backend and keeps the current visible transcript until that backend produces a replacement
history, so provider switches do not instantly replace the thread UI. History merges the providers'
workspace catalogs.
Changing models or providers is refused while that pane has an active turn.

The project menu below the composer offers a directory picker, recent projects, and “Don’t work
in a project” (uses the home directory). A project switch is refused while any pane has an active
turn. `index.ts` saves the departing pane set and restores the destination's saved set, including
selection and provider conversation ids. A directory without saved panes receives a fresh chat.
This is directory selection; it does not create a Git branch or worktree.

On launch only the selected pane is warmed. Selecting another pane immediately displays its
available snapshot, then wakes its runtime asynchronously. Unselected panes without an active
turn are parked after five minutes. Titles and last turn-boundary times are persisted so dormant
panes can still be named after a restart.

Startup and ordinary new-chat creation trim excess panes toward eight, oldest eligible first.
The selected pane, active turns, and undelivered continuation digests are protected, so this is
not a hard concurrency limit. Retiring a pane preserves its provider thread for reopening from
history. Leaving an unused empty pane can discard that placeholder.

Continuation creates a new pane with a local transcript digest, delivered once on its next
message. Branching from a completed response limits that digest to the chosen response; it
does not clone the provider's full session. User/assistant text is included, while tools,
reasoning, and images stay in the original chat. See `chat-context/thread-handoff.ts`.

Models can save a structured working checkpoint with `peer_chats.checkpoint`: goal, constraints,
decisions, progress, next steps, and file references. One checkpoint per pane is stored with its
thread id, revision, and transcript boundary in `app-settings.json`; it is usable only for that
thread. State is capped at 6,000 serialized characters and oversized saves are rejected. Writes
require the caller's active turn and matching expected revision. These are model-authored notes,
not verified facts or authorization. They are not automatically regenerated or injected each turn.

A continuation copies an applicable checkpoint into its existing ≤12k-character handoff, alongside
recent conversation. It freezes the source's last item id, and `peer_chats.recall` can search the
current transcript or read that direct source—even after the source pane closes—without opening
it in the UI. Source recall stops at the saved boundary. A checkpoint newer than a branch point
is not carried. Missing boundaries (including legacy continuations) fail closed. Retrieval uses
existing provider stores; no second transcript archive or automatic provider-session rotation
is introduced. See [Model context](model-context.md) for trust and [Tools](tools.md) for limits.

## Chat surface

- The sidebar keeps only running chats in Current. Every finished turn moves immediately to
  Recently completed, whether or not the pane was selected; opening it marks it reviewed without
  moving it. A new turn returns it to Current, while a reviewed chat with no new activity moves to
  History after ten minutes. Unreviewed completions remain in Recently completed.
  Thread history is cached for five seconds, and peer-summary updates are throttled to 200 ms
  during streaming. Summaries update from events, retain transcript order during late tool updates,
  and cap previews at 240 characters. Message deltas still go to the selected conversation.
- The renderer initially receives the newest 200 transcript items. "Show earlier" fetches older
  pages by stable item id; stale responses after a chat switch are ignored. Background-task status
  remains available outside the loaded page. Provider sessions and the main-process transcript
  remain complete for continuation, branching, and peer reads; this is display paging, not model
  compaction. Codex history replay emits one replacement instead of streaming old items again.
- The model menu groups all three providers. Its initial list usually shows five models,
  ranked by locally recorded picker use and always including the selected model. With no usage
  history it alternates providers; a single remaining model is shown rather than hidden.
- Tool activity is grouped into expandable step lists with arguments, output, status, and timing
  when available. Provider-native background tasks have a separate transcript group and a
  status popover. A turn ending does not prove that all background tasks finished.
- Completed assistant responses offer copy, locally saved thumbs-up/down feedback, and branching.
  Timestamps appear when recorded; older history does not acquire invented timestamps. Feedback
  is stored in renderer localStorage and is not sent to providers.
- The project rail contains the working timer, project menu, Tools, and Turn trace. Send/stop
  controls live in the composer. Appearance settings separate message and composer font sizes
  (defaults 14 and 15 px, range 13–22) from chat zoom.
- Ctrl/Cmd+, opens settings. Ctrl/Cmd+H opens chat history. Browser and chat zoom have separate
  controls; these shell shortcuts are handled in `renderer/app-shortcuts.ts`.

Provider background tasks and app panes are separate concepts. Claude tracks task notifications
across turn boundaries with `ClaudeBackgroundTasks`; Codex collaboration items are marked as
background agent activity. The read-only `peer_chats.list`/`read` directory exposes other panes and visible
subagent summary items, not an independent process-control API for every SDK task.

## Browser surface

`BrowserService` owns a `WebContentsView` per tab and one `persist:browser` partition. Cookies,
login state, history, and downloads are app-wide. The initial cookie import runs before the first
page load. Tab state and history are persisted separately.

The omnibox combines navigation/search input with inline completion and a history suggestion
list. History matches can be removed through `browser.removeHistory`; this deletes the stored
history entry, not cookies or site data. `browser-omnibox.ts` owns the renderer interaction and
`browser-history-store.ts` owns matching and persistence.

Ordinary popups become tabs; OAuth/utility windows can retain a native opener bridge. Native
popups are registered as `popup-<webContents id>` CDP roots with an opener id and do not appear
in the tab strip. Raw CDP can address a known popup root; semantic page input currently requires
a visible regular tab.

Browser inspection can read a background tab without selecting it. Semantic page input brings
the tab forward, waits for rendering after a switch, and reports `activatedTab: true`. It fails
if the browser page cannot be shown. Captures use a rendering lease and readiness checks;
shared frame settling lives in `browser-frame-settle.ts`. See [CDP](cdp-tool-foundation.md).

## Ownership map

| Concern | Source of truth |
|---|---|
| Bootstrap, service composition, project persistence | `src/main/index.ts`, `src/main/app-settings-store.ts` |
| Pane lifecycle, summaries, per-pane settings, idle parking | `src/main/chat-peers/` |
| Provider routing and id families | `src/main/chat-hub.ts`, `src/shared/chat-providers.ts` |
| Codex runtime and transcript normalization | `src/main/chat-service.ts`, `src/main/app-server-client.ts`, `src/main/chat-normalizers.ts` |
| Claude / Antigravity sessions and translation | `src/main/claude/`, `src/main/antigravity/` |
| Model instructions, trust and handoff | `src/main/chat-context/`, provider `*-instructions.ts` files |
| Provider-neutral tool definitions and execution | `src/main/tools/` |
| Deterministic app commands and renderer control access | `src/main/app-commands.ts`, `src/main/app-automation-*.ts`, `src/shared/ui-controls.ts` |
| Browser, history, popups, CDP sessions and input | `src/main/browser-*.ts`, `src/main/cdp/` |
| Typed IPC contract and narrow preload | `src/shared/api.ts`, `src/preload/index.ts` |
| Chat/project/sidebar orchestration | `src/renderer/chat-pane.tsx`, `src/renderer/project-menu.tsx`, `src/renderer/side-drawer/` |
| Transcript steps, background work, response actions | `src/renderer/transcript-rows.ts`, `src/renderer/activity-steps.ts`, `src/renderer/background-tasks.tsx`, `src/renderer/message-actions.tsx` |
| Reusable presentation and scrolling | `src/components/ui/`; backend access stays outside this layer |

`src/shared/` remains dependency-free. Renderer backend calls go through preload; model calls go
through the main-process registry. Interactive controls use manifest ids, not model-invented
DOM selectors. The generated workspace index supplies file and IPC navigation; `find` and
`outline` scan source on demand. See [Tools](tools.md) and [Model context](model-context.md).

## State and retention

App-owned files live under Electron's `userData` (`~/.config/closedai/` on Linux by default).

| Store | Contents |
|---|---|
| `app-settings.json` | Cookie-import latch; active workspace/project; active `chatPeers` and `chatSelectedPaneId`; saved project pane sets in `chatWorkspaces`; per-pane model, effort, provider ids, title, activity time, and continuation digest; tool switches and context/batch settings |
| `browser-tabs.json`, `browser-history.json` | Restored tabs and omnibox history |
| `Partitions/browser`, `code-cache/` | Chromium session data and app-configured code cache |
| `tool-telemetry.json` | Aggregate run/error/timeout counters; no arguments or conversation text |
| `antigravity/profile/`, `antigravity/attachments/`, `antigravity/transcripts/` | Generated agent plugin, materialized image attachments, and app-recorded transcripts; the CLI retains its own conversation store |
| Renderer localStorage | Appearance, model-picker usage, drawer state/review queue (including review time), message timestamps and local feedback |
| In-memory trace | At most 4,000 entries and 24,000,000 detail characters, 48,000 characters per detail before its truncation marker; cleared on restart |

Legacy top-level `chatThreadId`, `chatClaudeSessionId`, `chatAntigravityConversationId`, model,
and effort fields coexist with per-pane records. New code should use `PeerSettings` for a pane's
settings, not assume those top-level fields describe every chat. Provider session history lives
in each provider's own store; closing a pane and archiving a thread are distinct operations.

Codex-specific settings are `chatCompactAtPercent` (default 80), `chatCompactAtTokens` (default
zero, opt-in between-turn token threshold), and `chatMidTurnCompactTokens` (default zero, leaves
the CLI's limit). The percentage and between-turn token triggers are independent; setting both
to zero disables app-triggered compaction. The token trigger waits for 15 seconds of idle time;
a new send cancels it if it has not started. Repeated token-triggered compactions require five
minutes and at least max(4,000, 25% of the configured budget) token growth since the lowest usage
observed from the last attempt onward. Window-percentage pressure bypasses that grace/cooldown.
This is a soft trigger, not a hard context cap or a guarantee that native compaction reaches the
target. Claude keeps SDK-native automatic/precomputed compaction; Antigravity has no equivalent
app-configured token threshold. No provider history is deleted or session silently replaced.

The Turn trace shows send-to-first-assistant-text timing for all three providers: preparation,
Codex's measured compaction wait (a subset of preparation), and time after provider dispatch.
The clock starts when the pane manager receives Send, before waking the pane. It ends when main
receives non-empty assistant text, including commentary, not when the renderer paints it. Provider
queueing, reasoning, tools, and internal compaction are not individually separated after dispatch.
See [Tools](tools.md) for configuration and measurement limits.

`toolBatchMaxCalls` defaults to 16, is clamped to 1–64, and takes effect on app startup.

## Known boundaries from this source review

- The saved “No project” identity is currently coalesced to the working directory on startup in
  `index.ts`; the home directory can therefore return with a project label after relaunch.
- `ChatPeerManager.selectProject` does not invalidate its five-second history cache or an
  in-flight history read, so the departing project's history can briefly appear after a switch.
- Claude's session idle timer respects background tasks, but outer pane parking and project
  switching check `activeTurnId`. Background work after a turn is not protected from those
  lifecycle operations. Explicit session retirement marks tracked unfinished tasks stopped.
- Raw `browser_cdp.protocol` calls bypass the semantic wrapper's input foregrounding and the
  capture namespace's image budget/storage. Target auto-attachment does not make the semantic
  wrapper traverse every out-of-process frame. These are described in the CDP guide.

These are source-level findings, not reproduced live failures or fixes delivered by this
documentation update. Dated visual verification gaps remain in [composer QA](../design-qa.md).
