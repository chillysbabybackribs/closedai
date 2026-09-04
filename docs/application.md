# Application guide

Source review: 2026-09-04, including the current uncommitted changes. This describes implemented
behavior, not a new live UI or provider verification. Protocol measurements retain their dates
in the provider guides.

## Projects, chats, panes, and conversations

A chat is an app-owned `ChatRecord` in `ChatStore` (`chats.json`): a stable id, its project
directory, provider, model and effort, per-provider thread ids, title, preview, timestamps, an
archived flag, and any continuation digest or checkpoint. Records outlive panes, provider
processes, and relaunches. `ChatPeerManager` owns the active project's *attached* chats: an
attached chat has a pane, and **the pane id is the chat id**. Each attached chat has its own
`ChatHub`, provider settings (`PeerSettings`, a projection of the record), and conversation state;
multiple panes can be displayed together in a resizable chat layout. Selection identifies the focused
chat independently of visibility. A background pane can continue its turn while another pane is
selected. Hiding a tile only removes it from the layout. Detaching a pane stops its runtime and keeps the record, so the drawer row and its review
state never change identity. The embedded browser belongs to the application and is shared across
panes and project switches.

`ChatHub` routes to Codex, Claude Code, Antigravity, or Cursor. Codex model/thread ids are
unprefixed; Claude ids use `claude:`, Antigravity ids use `agy:`, and Cursor ids use `cursor:`. Picking another provider's model keeps the
pane in its conversation: the destination leaves whatever chat it last had open, starts a fresh
thread carrying a digest of the visible one (the same handoff “Continue in new chat” builds, sent
with the next message), and the pane keeps showing the transcript it had. The hub holds those
carried messages, so every later snapshot and history page shows them above the new provider's own
until the pane leaves that conversation (a new chat, a thread opened from history, or the provider
clearing itself); they are in memory only and a relaunch shows just the new provider's thread. The
chat the destination left stays in history. Opening another provider's thread from history is the
other direction and shows that thread. History merges the providers' workspace catalogs.
Changing models or providers is refused while that pane has an active turn. Picking a model is a
UI act and starts no process: the pick is written to the chat record, the pane repaints at once on
the new provider — ready, on that model, with the transcript it had — and the provider is
*dormant* until the first message needs it, when the hub starts it and hands the pick over. A pick
made while the provider is still coming up (at launch, say) is kept the same way. Only a provider
the workspace has never listed (nothing cached to validate the pick against) starts on the switch;
sends and further switches made meanwhile wait for that hand-over, and a switch whose provider
fails to come up puts the pane back. The composer is usable while a provider is “Starting…”: the
picker lists the cached catalog and a send waits for the provider itself. That wait happens behind
the message, not in front of it — every provider paints the user's message into the transcript
first and only then runs the hub's dormant start, so the composer empties and the chat leaves its
empty state as soon as a message is accepted, whatever the provider is doing. Waking a pane never
reconnects a provider that is already ready.

Codex model entries are supplemented with their native context capacity because app-server
`model/list` does not expose context sizes. Known current model ids use OpenAI's published native
capacity; this takes precedence over the installed CLI's `models_cache.json`, whose
`max_context_window` can be a lower Codex product default (for example, Spark advertises 128K there
despite the GPT-5.3-Codex model's 400K native window). Unknown models fall back to the cache maximum.
New and resumed threads receive that model-specific maximum through `model_context_window`;
changing models on an existing idle thread reapplies the matching override before saving the
selection. The model picker shows the same maximum beside each Codex model. If neither a known
capacity nor valid cache metadata is available, the model stays available without a context label
and Codex keeps its own default. The live context meter can report a slightly smaller effective
window because Codex reserves headroom according to its model catalog.

The project menu below the composer offers a directory picker, recent projects, and “Don’t work
in a project” (uses the home directory). A project switch is refused while any pane has an active
turn. `index.ts` saves the departing project's open chat ids and restores the destination's,
including selection; conversation ids live on the records. A directory without saved open chats
receives a fresh chat. This is directory selection; it does not create a Git branch or worktree.

On launch only the selected pane is warmed. Selecting another pane immediately displays its
available snapshot, then wakes its runtime asynchronously. A pane with no snapshot of its own —
parked, detached, or freshly restored — paints from the chat's saved view instead: the last 60
transcript items (capped at 256 KB), its thread name, and the context reading it was last
measured with, written to `chat-transcripts/<chat id>.json` at each turn boundary and read back
before the pane is announced. The view is display-only and never reaches a model; the provider's
replay replaces it as soon as it lands, and it is used only while the chat still holds the thread
it was taken from, so a new chat or a provider switch shows nothing stale. "Show earlier" from
such a pane wakes the provider first, since earlier messages come from the thread itself. The
composer names the chat's saved model and effort while its provider is still starting, rather
than "Choose model". Unselected panes without an active
turn are parked after five minutes, the selected pane after twenty, and at most two unselected
idle panes stay awake: creating or opening a chat parks the least recently active beyond that at
once, so consecutive new chats do not stack pane-owned provider processes. Parking stops those
pane-owned processes but keeps the pane, its in-memory transcript, and the record; the next message
wakes it. Codex instead has one app-server per active workspace. Every Codex pane keeps independent
thread, transcript, model, turn, tool, and trace state while its routed session shares that process,
account read, and model catalog. Parking a Codex pane keeps the workspace process; detaching it
releases the routed session, while a project switch or app quit stops the process. Provider
processes are spawned in their own process group and stopped as a group (SIGTERM, then SIGKILL
after three seconds), so the worker a CLI launcher forks dies with it, and every tracked group is
killed at quit (`src/main/process-tree.ts`). Titles and last turn-boundary times are persisted on
the record so dormant chats can still be named after a restart.

Startup, new chat, and opening a chat trim attached panes toward eight, least recently active
first. The selected and visible panes, active turns, operations in flight, and undelivered continuation
digests are protected, so this is not a hard concurrency limit. Detaching keeps the record and
its provider thread; the chat reopens from the drawer under the same id. A blank new chat (no
thread, no messages, no continuation, no open or wake in flight) may be discarded when the user leaves
it, but a chat still visible in the layout is retained.

`newChat` creates the record, attaches and selects it, announces the workspace before any
settings write, then wakes it; “Continue in new chat” takes the same path. `openChat(chatId)`
selects an attached chat, or attaches a detached one and resumes from its thread ids without
minting a new id. Main retains existing attached chats unless a departed chat is blank and no
longer visible. The renderer decides which tile displays a selected chat, as described below.

Continuation creates a new pane with a local transcript digest, delivered once on its next
message. Branching from a completed response limits that digest to the chosen response; it
does not clone the provider's full session. User/assistant text is included, while tools,
reasoning, and images stay in the original chat. See `chat-context/thread-handoff.ts`.

Models can save a structured working checkpoint with `peer_chats.checkpoint`: goal, constraints,
decisions, progress, next steps, and file references. One checkpoint per chat is stored with its
thread id, revision, and transcript boundary on the chat record; it is usable only for that
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

## Workspace layout

The sidebar, chat layout, and shared browser are independent regions. Two full-height chats can
sit side by side while both the sidebar and browser remain open. The browser stays docked on the
right; a toggle beside the split icons in each chat header hides/restores its native view without closing tabs. The sidebar keeps
its existing toggle. Chat headers offer **New chat to the right**, **New chat below**, and **Hide
chat pane**. Hiding a tile neither detaches its runtime nor stops its turn; closing a drawer row
still detaches and stops it.

Each tile header shows conversation tabs and a **+** button for **New chat tab**. It uses that
tile's active chat model, adds a tab, and selects it while retaining the previous tabs and the
other tiles and divider sizes. Click a tab to return to its conversation; arrow keys and Home/End
also switch tabs. Tab strips scroll horizontally when full. Mounted drafts and attachments survive
switching tabs. Each tab's close button removes it from the layout without deleting its history
or stopping a running turn. Closing the active tab selects a neighbor; closing the last tab in a
tile removes that tile when another tile remains. The workspace always keeps at least one tab.
Hidden tabs can be parked or detached by normal runtime trimming and are reattached when selected.

Drag a chat header or sidebar chat row onto another tile's left, right, top, or bottom edge. A
highlight previews the destination. Moving a tile collapses its former empty split, and its
mounted composer, draft, attachments, and transcript scroller survive the move. Existing chats
are added by dragging their sidebar rows onto a tile edge or right-clicking a row and choosing
**Split right** (vertical divider) or **Split below** (horizontal divider). These actions open that
chat alongside the focused pane, moving its tile if already visible; they are disabled for the
focused chat itself to avoid displaying the same conversation twice. New chats are added using the split
controls in each chat's title header. There is no separate layout toolbar or add-chat dropdown.
A normal sidebar click selects an existing tab wherever it lives, or replaces the focused tab,
leaving the other tabs and tiles in place. New Agent and continuation select a chat in the focused
tab; the split buttons explicitly add another tile. Moving a visible tile carries its tab group;
dragging a hidden tab's sidebar row to a tile edge splits that conversation out of its group.

Dividers resize horizontal and vertical splits independently; arrow keys resize a focused chat
divider and double-click resets it to equal proportions. Nested splits support columns, rows,
and quadrants, up to 32 visible chats. A tile has a 300 × 280 px minimum; the chat area scrolls
when a small window cannot fit the chosen arrangement. Narrow tiles use compact composer
controls. Browser visibility and the chat tree, including divider ratios, are saved per project
in renderer localStorage, including tab order and each tile's active tab. Missing/archived chats
are removed from a restored layout; layouts saved before tabs remain compatible.

`src/renderer/chat-layout/` owns the tree, geometry, persistence, and tile controls.
`chat.setVisiblePanes(cwd, paneIds, retainedTabIds?)` registers display subscriptions and protects visible chats
from attachment trimming and blank-chat cleanup. Retained tab ids also protect empty tabs from
blank-chat cleanup without waking or subscribing to inactive tabs. It ignores stale project updates. The shared
snapshot's `panes` map contains the bounded visible views; `selected` remains the focus view for
existing consumers. Hidden panes retain their main-process state but do not stream text over IPC.

## Chat surface

- The sidebar is driven by the workspace's chat records: the `chats` event carries one
  `ChatRowSummary` per record (attached or not) plus `running`, and every row is keyed by chat id.
  Right-click a row and choose Pin or Unpin. Pinned chats occupy a section above Current, newest
  pin first, and stay there through running, completion, pane closure, project switches, and relaunch.
  They appear once; a pinned child chat is lifted out of its parent's group. Unpinning restores
  normal activity placement. Pinning preserves activity timestamps and completion review marks,
  and an explicitly pinned blank chat is retained. The Pinned section is hidden when empty.
  Placement does not depend on selection. Current holds only unpinned running chats, newest created first
  (not by streaming activity, so rows do not reshuffle per token). Every finished turn moves
  immediately to Recently completed, whether or not the pane was selected; opening it marks it
  reviewed without moving it. A new turn returns it to Current, while a reviewed chat with no new
  activity moves to History after ten minutes. Unreviewed completions never expire, and the queue
  is pruned against the store's chat ids, not attached panes, so a completion survives detaching
  and relaunch. History is ordered by last activity. Clicking any row calls `openChat`; the layout focuses its tile if already visible,
  otherwise it replaces the focused tile. Closing an attached row keeps the chat in History (or Pinned); deleting a detached
  row archives it. Failures from opening, new chat, stop, archive, search, or the background
  catalog refresh show in the drawer footer for eight seconds instead of being swallowed.
  `listChats` answers from the store at once, then reconciles the providers' thread catalogs in
  the background (adopting threads the store has not seen, cached five seconds, invalidated on turn
  end, archive, open, and project switch; a scan that lands after a project switch is dropped).
  Peer-summary updates are throttled to 200 ms during streaming and a pending update is flushed on
  stop. Summaries update from events, carry `running` from one source (the hub's active turn),
  never reset a title to a placeholder on a wake, retain transcript order during late tool updates,
  and cap previews at 240 characters. The selected and visible panes' events cross chat IPC; main-process
  transcripts and trace observers still receive every pane's events. Registering visible panes
  delivers bounded snapshots before subsequent deltas, with actions and history pages routed by
  pane id. Focus changes preserve earlier pages already loaded in other visible panes. The sidebar uses a separate snapshot
  that stays stable during text/output deltas, keeping its row calculations out of the token stream.
- Chat events are batched by animation frame. Markdown renders that frame's current text without
  another timer, including the final chunk when a task completes. Code highlighting remains
  throttled to 250 ms and limited to 20,000 characters, but pending highlights show the current
  plain code rather than an older highlighted version.
- The renderer initially receives the newest 200 transcript items. "Show earlier" fetches older
  pages by stable item id; stale responses after a chat switch are ignored. Background-task status
  remains available outside the loaded page. Provider sessions and the main-process transcript
  remain complete for continuation, branching, and peer reads; this is display paging, not model
  compaction. Codex history replay emits one replacement instead of streaming old items again.
- The model menu opens on the providers, one row each, naming the model in use where that
  provider owns the selection. Choosing a row replaces the same panel with that provider's
  models under a sticky header that returns to the list; the selected model's reasoning efforts
  stay on the provider view's root, since they belong to the selection rather than to a
  provider. Each provider view opens on that provider's top few models, ranked by locally
  recorded picker use and always including the selected one, with the rest one row away; a
  single remaining model is shown rather than hidden. The panel is one fixed width, bounded by
  the chat pane it is given as a collision boundary, so the picker never reaches over the
  browser column and never triggers the freeze-and-still path that a DOM overlay across the
  divider requires.
- Tool activity is grouped into expandable step lists with arguments, output, status, and timing
  when available. Provider-native background tasks have a separate transcript group and a
  status popover. A turn ending does not prove that all background tasks finished.
- Completed assistant responses offer copy, locally saved thumbs-up/down feedback, and branching.
  Timestamps appear when recorded; older history does not acquire invented timestamps. Feedback
  is stored in renderer localStorage and is not sent to providers.
- The project rail contains the working timer, project menu, Tools, and Turn trace. Send, pause,
  and resume controls live in the composer. Pause ends the provider turn — no protocol can suspend
  a generation and restart the same one — but every lane keeps the partial answer and the
  conversation, so Resume is an ordinary next turn carrying `CHAT_RESUME_PROMPT`. It is offered
  from the turn's `paused` event until the next turn starts. Codex sends `turn/interrupt`, Claude
  the SDK's `interrupt`, Cursor the `session/cancel` **notification** (as a request cursor-agent
  ignores it and streams on), and Antigravity, which has no interrupt, kills its process and
  resumes the conversation id on the next turn. A pause while an Antigravity prompt is still
  queued behind the MCP primer drops that queued prompt against a warm process and says so, since
  the CLI never received the message. Appearance settings separate message and composer font sizes
  (defaults 14 and 15 px, range 13–22) from chat zoom.
- Ctrl/Cmd+, opens settings. Ctrl/Cmd+H opens chat history. Browser and chat zoom have separate
  controls; these shell shortcuts are handled in `renderer/app-shortcuts.ts`.
- Every http(s) URL a response references is clickable and opens in the app browser through
  `browser.openTab`, rendered as a favicon source chip with a hover preview. `components/ui/markdown.tsx`
  runs `remarkBareUrls` (`markdown-links.ts`) after remark-gfm so scheme-less hosts such as
  `example.com/path` become links too; the transformer skips code, existing links, and hosts outside
  its curated TLD list, which is what keeps `chat-transcript.tsx` and `package.json` as plain text.
  Non-http schemes stay inert. This is renderer-side, so it holds for every provider lane.

Provider background tasks and app panes are separate concepts. Claude tracks task notifications
across turn boundaries with `ClaudeBackgroundTasks`; Codex collaboration items are marked as
background agent activity. The read-only `peer_chats.list`/`read` directory exposes other panes and visible
subagent summary items, not an independent process-control API for every SDK task. `read` answers
"what is that pane doing" first: it pages from the newest item backwards, keeps a page inside a
serialized character budget by clipping long tool detail, output, diffs and screenshot data URLs,
and reports `totalItems` so a caller can place the page. `order: "oldest"`, `types` and `max_chars`
cover the rest; reasoning items still never cross into another pane.

## Browser surface

`BrowserService` owns a `WebContentsView` per tab and one `persist:browser` partition. Cookies,
login state, history, and downloads are app-wide. The initial cookie import runs before the first
page load. Tab state and history are persisted separately.

The omnibox combines navigation/search input with inline completion and a history suggestion
list. History matches can be removed through `browser.removeHistory`; this deletes the stored
history entry, not cookies or site data. `browser-omnibox.ts` owns the renderer interaction and
`browser-history-store.ts` owns matching and persistence.

Right-clicking a browser tab opens tab actions for opening a new tab to its right, reloading,
duplicating, renaming, closing, closing other tabs, and closing tabs to the right. Custom tab
names are tab-strip labels stored separately from the page title and are persisted with the tab
session.

Ordinary popups become tabs; OAuth/utility windows can retain a native opener bridge. Native
popups are registered as `popup-<webContents id>` CDP roots with an opener id and do not appear
in the tab strip. Raw CDP can address a known popup root; semantic page input currently requires
a visible regular tab.

The page view fills every compositor gap — between a navigation committing and the new
document's first paint, and whenever a hidden view is shown again — with one flat base colour.
That colour is not fixed. `browser-page-background.ts` measures each document's real canvas
colour at dom-ready and remembers it per origin, and the next gap on that origin is filled with
the colour the page is about to paint, so a gap is not a flash. A tab holding no document shows
the app's bezel colour, and a page that paints no background of its own still gets the browser
default of white. The renderer's overlay freeze waits for its still, then moves the still-compositing
native page outside the browser box instead of toggling its visibility; `browser:setBounds` waits
for a painted frame before resolving the return. This avoids both a blank capture gap and Electron's
loaded-view blanking failure when a `WebContentsView` is hidden and shown around an overlay.
Hiding the whole browser also keeps user tabs attached and parks the active surface beyond the
window at its last usable size. Reopening restores that same loaded page without a reload;
zero-size reports during panel collapse or expansion never replace the saved viewport. Keeping
these surfaces resident trades background rendering work for reliable restoration.
After a navigation becomes usable, and again when loading stops, the tab reasserts its unchanged
bounds and visibility. This revives Electron's frame sink when a redirect leaves DOM/CDP alive
but the attached native surface blank.

Browser inspection can read a background tab without selecting it. Semantic page input brings
the tab forward, waits for rendering after a switch, and reports `activatedTab: true`. It fails
if the browser page cannot be shown. Captures use a rendering lease and readiness checks;
shared frame settling lives in `browser-frame-settle.ts`. See [CDP](cdp-tool-foundation.md).

## Ownership map

| Concern | Source of truth |
|---|---|
| Bootstrap, service composition, project persistence | `src/main/index.ts`, `src/main/app-settings-store.ts` |
| Chat records and persistence, settings migration | `src/main/chat-store/`, `src/shared/chat-store.ts` |
| Attach/detach lifecycle, summaries, per-chat settings, idle parking, catalog reconciliation | `src/main/chat-peers/` |
| Per-workspace provider model catalog cache | `src/main/chat-context/provider-catalog-cache.ts` |
| Provider routing and id families | `src/main/chat-hub.ts`, `src/shared/chat-providers.ts` |
| Workspace Codex process, pane routing, and transcript normalization | `src/main/codex-workspace-runtime.ts`, `src/main/chat-service.ts`, `src/main/app-server-client.ts`, `src/main/chat-normalizers.ts` |
| Claude / Antigravity / Cursor sessions and translation | `src/main/claude/`, `src/main/antigravity/`, `src/main/cursor/` |
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

Before a follow-up Send, the app can report changed source versions previously observed by that
chat's source tools. This adds a small untrusted context fragment only when changes are found,
with no model call or repository-wide scan. It covers the shared workspace source reader in all
four providers and verified native Claude reads. The bounded comparison waits up to 250 ms;
version histories are memory-only, scoped by pane/thread/workspace, and do not represent what
remains in model context. See [Model context](model-context.md) for limits and trust boundaries.

App-owned files live under Electron's `userData` (`~/.config/closedai/` on Linux by default).

| Store | Contents |
|---|---|
| `provider-catalogs.json` | The last model catalog read per workspace and provider, so a relaunch starts only the active provider and the picker still offers every model; a provider refreshes its own entry when selected |
| `chat-transcripts/<chat id>.json` | The bounded tail of each chat as the app last showed it, so opening one paints before its provider replays; display-only, pruned against the store's live chat ids on launch |
| `chats.json` | Every chat record: id, project directory, provider, model and effort, per-provider thread ids, title, preview, created/updated/last-turn times, archived flag, pin timestamp, parent chat, continuation digest, checkpoint. Debounced atomic writes; flushed on quit |
| `app-settings.json` | Cookie-import latch; active workspace/project; the open chat ids (`chatOpenIds`) and `chatSelectedPaneId`; saved per-project open ids and selection in `chatWorkspaces`; tool switches and context/batch settings. Legacy `chatPeers` and `chatWorkspaces[].peers` are imported into `chats.json` once, keeping each pane id as the chat id, and removed |
| `browser-tabs.json`, `browser-history.json` | Restored tabs and omnibox history |
| `Partitions/browser`, `code-cache/` | Chromium session data and app-configured code cache |
| `tool-telemetry.json` | Aggregate run/error/timeout counters; no arguments or conversation text |
| `antigravity/profile/`, `antigravity/attachments/`, `antigravity/transcripts/` | Generated agent plugin, materialized image attachments, and app-recorded transcripts; the CLI retains its own conversation store |
| Renderer localStorage | Appearance, model-picker usage, drawer state/review queue (including review time), message timestamps and local feedback |
| In-memory trace | At most 4,000 entries and 24,000,000 detail characters, 48,000 characters per detail before its truncation marker; cleared on restart |

Legacy top-level `chatThreadId`, `chatClaudeSessionId`, `chatAntigravityConversationId`, model,
and effort fields coexist with chat records. New code should use `PeerSettings` (a projection of
the chat record) for a chat's settings, not assume those top-level fields describe every chat.
Provider session history lives in each provider's own store; closing a pane, archiving a chat, and
archiving a provider thread are distinct operations.

Codex-specific settings are `chatCompactAtPercent` (default 80), `chatCompactAtTokens` (default
zero, opt-in between-turn token threshold), and `chatMidTurnCompactTokens` (default zero, leaves
the CLI's limit). The percentage and between-turn token triggers are independent; setting both
to zero disables app-triggered compaction. The token trigger waits for 15 seconds of idle time;
a new send cancels it if it has not started. Repeated token-triggered compactions require five
minutes and at least max(4,000, 25% of the configured budget) token growth since the lowest usage
observed from the last attempt onward. Window-percentage pressure bypasses that grace/cooldown.
This is a soft trigger, not a hard context cap or a guarantee that native compaction reaches the
target. Claude keeps SDK-native automatic/precomputed compaction; Antigravity compaction is manual re-seed only
(no context gauge or auto trigger). No provider history is deleted or session silently replaced.

The Turn trace shows send-to-first-assistant-text timing for all four providers: preparation,
Codex's measured compaction wait (a subset of preparation), and time after provider dispatch.
The clock starts when the pane manager receives Send, before waking the pane. It ends when main
receives non-empty assistant text, including commentary, not when the renderer paints it. Provider
queueing, reasoning, tools, and internal compaction are not individually separated after dispatch.
See [Tools](tools.md) for configuration and measurement limits.

`toolBatchMaxCalls` defaults to 16, is clamped to 1–64, and takes effect on app startup.

## Known boundaries from this source review

Parallel research now has an initial model-facing implementation: `search.run` starts several
queries and begins static source collection as each provider responds; `search.read` retrieves
incremental results and retained excerpts. Both search tools default to live presentation, opening
a browser tab with an actual source as soon as an eligible URL arrives, while other providers and
reads continue. Discovery stays in the search APIs; search-engine results pages never serve as
the research presentation. Subsequent searches in the same pane/thread/turn reuse that tab.
Models receive its id for inspecting source pages while research continues. Explicit background
mode opts out. Source fetching is unauthenticated; the visible tab uses the
normal browser session. Runs are tied to the calling pane/thread/turn and stop with that turn or
pane. There is no dedicated research activity panel or hidden rendered-worker pool yet. See
[Tools](tools.md#parallel-research-runs) for exact limits and the
[design proposal](parallel-web-research-2026-09-04.md) for the remaining work.

- The saved “No project” identity is currently coalesced to the working directory on startup in
  `index.ts`; the home directory can therefore return with a project label after relaunch.
- Provider threads the store has never seen appear in the drawer only after the background
  reconciliation adopts them, so a chat created in a provider's own CLI can lag one refresh.
- Claude's session idle timer respects background tasks, but outer pane parking and project
  switching check `activeTurnId`. Background work after a turn is not protected from those
  lifecycle operations. Explicit session retirement marks tracked unfinished tasks stopped.
- Raw `browser_cdp.protocol` calls bypass the semantic wrapper's input foregrounding and the
  capture namespace's image budget/storage. Target auto-attachment does not make the semantic
  wrapper traverse every out-of-process frame. These are described in the CDP guide.

These are source-level findings, not reproduced live failures or fixes delivered by this
documentation update. Dated visual verification gaps remain in [composer QA](../design-qa.md).
