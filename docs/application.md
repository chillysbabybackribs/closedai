# Application guide

Chat renders Markdown, but does not interpret the Visualize skill's inline content-reference
markers or provide its `Tweak`/`window.openai` host runtime. HTML comparisons can be served locally
and viewed in the embedded browser; local HTML file links instead open a text preview.

Codex's native `imageGeneration` results render inline in the transcript, both during live turns
and when replaying a saved thread. Click a generated image to open the full-size browser-pane
image viewer. Pending generation remains an activity row; failures display an error. The revised
generation prompt is not used as a caption. These images are display data, not instructions.

Source review: 2026-09-21. This describes implemented behavior, not a new live UI or provider
verification. Protocol measurements retain their dates in the provider guides. Provider context
delivery lives in [Model context](model-context.md); registry contracts live in
[Tools](tools.md).

Renderer UI changes are verified in Electron (`npm run build &&
npm run preview`, or `npm run dev` for hot reload). There is no separate browser-only renderer
entry or fixture bridge.

## Native instrumentation

The initial local Linux backend offers process discovery, finite native inspection and custom
Frida probes through a separate controller. Each experiment attempts unload/detach before returning;
receipts, cancellation and event budgets belong to the main-process service. Custom probes can
modify or crash the target. Browser semantics remain in the browser/CDP services. See
[implemented contracts and validation](native-instrumentation.md).

## Projects, chats, panes, and conversations

A chat is an app-owned `ChatRecord` in `ChatStore` (`chats.json`): a stable id, its project
directory, provider, model and effort, per-provider thread ids, title, preview, timestamps, an
archived flag, and any continuation digest or checkpoint. Records outlive panes, provider
processes, and relaunches. `ChatPeerManager` owns *attached* chats across directories: an
attached chat has a pane, and **the pane id is the chat id**. Each attached chat has its own
`ChatHub`, provider settings (`PeerSettings`, a projection of the record), and conversation state;
multiple panes can be displayed together in a resizable chat layout. Selection identifies the focused
chat independently of visibility. A background pane can continue its turn while another pane is
selected. Hiding a tile only removes it from the layout. Detaching a pane stops its runtime and keeps
the record and unread state under the same identity. The embedded browser belongs to the application and is shared across
panes and project switches.

Onboarding and missing binaries. A provider whose executable is absent is an onboarding state,
not a fault: the lane sets its connection to `unavailable` with one install sentence
(`src/main/provider-binary.ts`, e.g. "Codex is not installed. Install the Codex CLI and sign in
from the app, or choose another model.") instead of the raw `spawn codex ENOENT`. The Codex
restart loop then re-probes every 60 s rather than every 15 s and recovers on its own once the
binary appears; Claude, Antigravity, and Cursor map the same condition to their own sentence. A
first-run screen reads `window.closedai.chat.providerAvailability()` (`ProviderAvailability[]`
from `src/shared/provider-availability.ts`: provider, installed, resolved path, hint) before any
chat starts a provider; resolution follows each lane's spawn order (env override, the installer's
`~/.local/bin`, then PATH; Claude is the bundled SDK and always present).

Launch resilience. A bootstrap failure is shown in a native error box and ends the app; an
uncaught exception or unhandled rejection after the window exists is logged with a `[main]`
prefix and survived (`src/main/app-crash-guard.ts`). The app shell reloads once when its renderer
is lost for a non-clean reason and reports a second loss within a minute instead of looping
(`src/main/main-window-recovery.ts`). `before-quit` bounds its flush at 5 s and quits regardless
(`src/main/app-quit.ts`); the MCP HTTP bridges drop open connections before closing their listener.

Model browser tools assign tabs per chat, independently of directory and UI selection. Mutations
expect an owned tab; observing verbs on any tab claim nothing; acting claims a tab and refuses
another chat's assignment. Locks, batching, popups, and `state.browser.coordination` are specified in
[Tools](tools.md#application-facts-browser-targets-and-batching). Regression coverage:
`xvfb-run -a node scripts/browser-coordination-live-check.mjs`.

`ChatHub` routes to Codex, Claude Code, Antigravity, or Cursor. Codex model/thread ids are
unprefixed; Claude ids use `claude:`, Antigravity ids use `agy:`, and Cursor ids use `cursor:`. Claude ids
wrap the CLI's model alias, which the CLI renames between launches (`claude-fable-5-1` one day,
`claude-fable-5-1[1m]` the next); a saved id the current catalog no longer lists verbatim is
matched through the model it resolved to and rewritten under today's alias, so a Claude pane
reopens on its own model rather than the default. Picking another provider's model keeps the
pane in its conversation: the destination leaves whatever chat it last had open, starts a fresh
thread carrying a digest of the visible one (the same handoff “Continue in new chat” builds, sent
with the next message), and the pane keeps showing the transcript it had. An applicable working
checkpoint is included in that digest, and the destination retains the frozen source boundary so
`peer_chats.recall` can recover older omitted evidence. The hub holds those carried messages, so
every later snapshot and history page shows them above the new provider's own
until the pane leaves that conversation (a new chat, a thread opened from history, or the provider
clearing itself); they are in memory only and a relaunch shows just the new provider's thread. The
chat the destination left stays in history. Opening another provider's thread from history is the
other direction and shows that thread. History merges the providers' workspace catalogs.
Changing models or providers is refused while that pane has an active turn. Picking a model is a
UI act that writes the choice to the chat record and repaints the pane at once — ready, on that
model, with the transcript it had. When the pick targets a provider whose catalog is already
cached, the hub also starts that provider's warm path in the background so typing the first
message is not blocked on cold startup; Send still awaits that work if it has not finished. A pick
to a provider the workspace has never listed (nothing cached to validate it against) starts on the
switch instead. Sends and further switches made meanwhile wait for any in-flight hand-over, and a
switch whose provider fails to come up puts the pane back. The composer is usable while a provider
is “Starting…”: the picker lists the cached catalog and a send waits for the provider itself when
needed. That wait happens behind the message, not in front of it — every provider paints the user's
message into the transcript first and only then runs any remaining hub preparation, so the composer
empties and the chat leaves its empty state as soon as a message is accepted. Waking a pane never
reconnects a provider that is already ready.

Codex model entries are supplemented with their native context capacity because app-server
`model/list` does not expose context sizes. Known current model ids use OpenAI's published native
capacity; this takes precedence over the installed CLI's `models_cache.json`, whose
`max_context_window` can be a lower Codex product default (for example, Spark advertises 128K there
despite the GPT-5.3-Codex model's 400K native window). Unknown models fall back to the cache maximum.
New and resumed threads receive that model-specific maximum through `model_context_window`;
changing models on an existing idle thread reapplies the matching override before saving the
selection. If neither a known capacity nor valid cache metadata is available, the model stays
available without a context label and Codex keeps its own default. The live context meter under
the composer can report a slightly smaller effective
window because Codex reserves headroom according to its model catalog.

GPT-6 Astra (`gpt-6-astra`) is discovered through the same account-provided model catalog,
with reasoning options supplied by Codex and a native context capacity of 1,050,000 tokens
from [OpenAI's model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra).
Restart ClosedAI to refresh an already-loaded model catalog after a new model becomes available.

Codex tool catalogs are saved with provider threads. Restarting loads new tool implementations,
but Codex 0.154 does not replace a saved tool catalog on resume. Before the next send, ClosedAI
compares the saved rollout catalog with the enabled registry. Changed or unreadable catalogs
use the existing session handoff to start a fresh provider thread, preserving the visible
conversation and source recall. This also applies to tool switches, independently of idle
context rotation; unchanged catalogs keep their thread.

The Folder section of each composer's setup panel (`composer.setup`) changes only that chat's
working directory. It offers a directory picker (`composer.project-new`), recent projects
(`composer.project-recent`), and “Don’t work in a project” (`composer.project-clear`, uses the home
directory); the setup trigger below the composer names the current model on the left and folder on
the right.
The chat keeps its identity, messages, draft, and scroll position; other tabs, split panes, and the
browser stay in place. Chats from different directories can share the layout, and focusing a chat
or opening a history search result does not switch the workspace. New chats inherit the focused
chat's directory; a continued chat inherits its source chat's. Open chat ids are restored across directories after relaunch.

A folder selected during a turn is labeled “queued” and applies after that chat's foreground and
background work finishes; paused work also waits. Other chats can keep running. The latest queued
choice wins, selecting the current folder cancels it, and unapplied choices do not survive restart.
Applying rebuilds only the selected chat's provider runtime with the new cwd and a bounded
conversation handoff for its next message. The existing transcript remains visible; the original
provider thread and directory are retained as the bounded history source for reopening and recall.
This does not create a Git branch or worktree. The model-requested workspace switch below remains
a separate operation with its existing workspace selection and continuation behavior.

Models can request `closedai_app.command project_switch` with `project_op: request` and an absolute
existing `project_path`. One in-memory request waits for every pane and pane operation to become
idle. Acceptance means pending: the model must finish its turn. The app verifies the destination,
creates a fresh chat using the caller's model and conversation handoff (independent of focus),
and submits a continuation of the previously authorized task. Existing destination conversations
are not sent messages. Completed means the switch was verified and the continuation submitted,
not that the continued task succeeded.

`closedai_app.state` exposes the active project and latest `workspace.projectSwitch` status,
including failures and the destination pane when created. Transcript notices report status changes.
`project_switch project_op: cancel` releases the caller's pending request. Stopping or messaging that
caller, closing it, changing its thread, manual project selection, and app shutdown also cancel
pending work. An applying switch blocks new sends and cannot be cancelled or retried automatically.
Requests do not survive restarts. Failed sequential tool batches cancel their queued switch.
A provider send failure leaves the destination and handoff available for inspection and recovery.

On launch only the selected pane is warmed. Selecting another pane immediately displays its
available snapshot, then wakes its runtime asynchronously. A pane with no snapshot of its own —
parked, detached, or freshly restored — paints from the chat's saved view instead: the last 60
transcript items (capped at 256 KB), its thread name, and the context reading it was last
measured with, written to `chat-transcripts/<chat id>.json` at each turn boundary and read back
before the pane is announced. The view is display-only and never reaches a model; the provider's
replay replaces it as soon as it lands, and it is used only while the chat still holds the thread
it was taken from, so a new chat or a provider switch shows nothing stale. The live transcript
shows the current turn by default; **View previous messages** loads one earlier user/model turn at
a time from the provider when needed. Such a pane wakes the provider first, since earlier messages
come from the thread itself. The
composer's setup trigger names the chat's saved model while its provider is still starting, rather
than "Choose model". Unselected panes without an active
turn are parked after five minutes, the selected pane after twenty, and at most two unselected
idle panes stay awake: creating or opening a chat parks the least recently active beyond that at
once, so consecutive new chats do not stack pane-owned provider processes. Parking stops those
pane-owned processes but keeps the pane, its in-memory transcript, and the record; the next message
wakes it. Codex instead has one app-server per active workspace. Every Codex pane keeps independent
thread, transcript, model, turn, tool, and trace state while its routed session shares that process,
account read, and model catalog. Parking a Codex pane keeps the workspace process; detaching it
releases the routed session. Codex runtimes are retained per visited directory until app quit;
project selection does not stop another directory's runtime. Provider
processes are spawned in their own process group and stopped as a group (SIGTERM, then SIGKILL
after three seconds), so the worker a CLI launcher forks dies with it, and every tracked group is
killed at quit (`src/main/process-tree.ts`). Titles and last turn-boundary times are persisted on
the record so dormant chats can still be named after a restart. Active chats request a
short descriptive title in the background from the initial user prompt and optional response, using the active provider
in a separate ephemeral request. The input contains bounded text from the user request
(and assistant response when available), with injected context stripped. Naming uses low reasoning, a 45-second deadline, and an
isolated temporary working directory; it does not add turns to the conversation. Claude disables
built-in tools and MCP; Codex disables shell, browsing, apps, image tools, delegation, and hooks,
ignores user config, and uses a read-only sandbox; Antigravity runs in low-effort print mode; Cursor runs in ask print mode. These requests consume provider usage.

The saved app-generated title wins in search results, tabs, and history, survives provider refreshes,
session changes and relaunches, and does not change the chat's activity time. Naming is attempted
once per chat; failures keep the provider name or first-message fallback. Stale results after a
thread/model change, archival, or detach are discarded. Existing chats become eligible on a later
completed turn; startup does not bulk-generate names. Manual rename and
auto-title retry controls are available via tab context menus and the chat rename dialog;
manual titles set `titleSource: 'manual'` and are preserved until cleared or reset. Fallback labels
strip `<closedai_context>` blocks and clip the first nonempty user-message line.

Startup, new chat, and opening a chat trim attached panes toward eight, least recently active
first. The selected and visible panes, active turns, operations in flight, and undelivered continuation
digests are protected, so this is not a hard concurrency limit. Detaching keeps the record and
its provider thread; the chat reopens from history search under the same id. A blank new chat (no
thread, no messages, no continuation, no open or wake in flight) may be discarded when the user leaves
it, but a chat still visible in the layout is retained.

`newChat` creates the record, attaches and selects it, announces the workspace before any
settings write, then wakes it; “Continue in new chat” takes the same path. `openChat(chatId)`
selects an attached chat, or attaches a detached one and resumes from its thread ids without
minting a new id. Main retains existing attached chats unless a departed chat is blank and no
longer visible. The renderer decides which tile displays a selected chat, as described below.

Continuation creates a new chat tab in the source tile with a local transcript digest, delivered once on its
next message. **Continue in new chat** (`chat.message-continue`) sits on the latest completed response
next to **Branch**; it is disabled while that chat's turn is actively running (`activeTurnId` set).
**Branch** (`chat.message-branch`) starts a new chat whose digest and `peer_chats.recall` boundary end at
that specific assistant message; **Continue** carries the full conversation through its current end.
Pausing a turn clears the active run (`activeTurnId`) and sets `pausedTurnId`, so Continue and Branch become
available while **Resume** remains on the source chat — pausing is not the same as a running turn, which
main refuses to digest. Branching from a completed response limits that digest to the chosen response; it
does not clone the provider's full session. User/assistant text is included, while tools,
reasoning, and images stay in the original chat. The digest opens with a "Where it stood" line
(how many requests, and whether the latest one was answered or cut off) and the source's
working directory; a continued chat also opens in that directory, not the focused chat's, when
the source has a record. Until its first message is sent, the new pane is an ordinary empty chat
with the composer ready for the next request. That first message delivers the handoff to the model;
the handoff is not rendered as synthetic transcript content. Drawer rows carry lineage as
`continuedFrom` (source id and title, plus the digest only while undelivered); a directory change
within one chat is not reported as a continuation.
See `chat-context/thread-handoff.ts` and `chat-peers/peer-continuation.ts`.

A chat record may still carry a legacy **working checkpoint** (goal, constraints, decisions,
progress, next steps, and file references) from earlier builds. There is no model-facing
checkpoint tool anymore; new checkpoints are not written. When present, checkpoints are
read-only legacy data and are model-authored notes, not verified facts.

A continuation or provider switch copies an applicable checkpoint into its existing
≤12k-character handoff, alongside recent conversation. It freezes the source's last item id, and
`peer_chats.recall` can search the current transcript or read that direct source—even after the
source pane closes—without opening it in the UI. Source recall stops at the saved boundary. A
checkpoint newer than a branch point is not carried. Missing boundaries (including legacy
continuations) fail closed. Retrieval uses existing provider stores; no second transcript
archive is introduced. When `chatSeamlessRotation` is enabled (default on; set false to opt out), idle context pressure
on Codex and Claude can rotate the provider session invisibly: the visible transcript stays put,
a thin seed is queued for the next send, and each rotation appends metadata to the chat record
for later recall-chain work. Source recall on the same pane after rotation reads the in-memory
transcript through the frozen boundary so tool output remains recoverable without reopening the
dropped provider thread. Disabling seamless rotation restores the native compaction path.
See [Model context](model-context.md) for trust and [Tools](tools.md) for limits.

Cross-project memory uses `peer_chats.list(scope=history)` and `recall(scope=history)` against
existing provider stores — no separate archive or mandatory checkpoint. See [Tools](tools.md) for
limits and [Model context](model-context.md) for prompt delivery.

## Workspace layout

The workspace has no sidebar. A centered title-bar input searches saved chat titles across projects.
Hovering over it opens a dropdown that stays open across the field, the gap, and the results;
leaving the component hides it, even while the input retains focus. Hovering does not steal keyboard
focus. Focusing, clicking, typing, or using arrow keys also opens it for keyboard and touch access.
The dropdown groups chats into Running, Paused, Recently completed (unread), Open (still attached),
and Closed (detached). Open and Closed each show up to eight chats, newest last turn first. Rows are
single lines in a command-palette surface wider than the input: a live-state glyph (or the provider's
mark when idle), the title, the project folder as a dim description, and the last-activity time on
the right; a search result also carries an Open/Closed tag since no group implies it. Empty groups
are omitted and each chat appears once. The closed input shows no count badges; at rest it shows
the Ctrl+H shortcut.
Activity groups include all matching chats in the scrollable
dropdown; unread completions use the persisted review queue and move into History when opened.
Typing shows one list of up to eight ranked, case-insensitive title matches across all groups, with
matched characters highlighted. Arrow keys select, Enter or click opens, and Escape dismisses; the
footer lists those keys and the result count. Each result has a trash button, shown for the selected
or hovered row, that removes the chat from history in one click without confirmation. The chat
hides immediately. Running chats cannot
be deleted; pending actions disable the buttons and failures appear below the search. The dropdown
stays open after deletion. Archive in the history panel uses the same immediate archive path.
Ctrl+H and File →
Search chats focus it. File → Manage chat history retains the full history management panel.
New chats use the tab + button or File → New chat (Ctrl+N).
Two full-height chats can
sit on either side of the browser. The browser starts on the right; drag a conversation tab,
or empty chat header space onto the browser's left or right half to dock it on that side.
During a chat drag, the native browser view is temporarily covered so the drop targets can receive
the gesture. A globe button beside Search chats in the top title bar hides/restores the browser in its saved position without
closing tabs. Chat headers offer **New chat to the right**, **New chat below**, and **Hide chat pane**.
Hiding a tile neither detaches its runtime nor stops its turn; the model command `close_chat`
still detaches and stops it.

Each tile header shows conversation tabs and a **+** button for **New chat tab**. It uses that
tile's active chat model, adds a tab, and selects it while retaining the previous tabs and the
other tiles and divider sizes. Tab creation waits for the renderer's workspace snapshot to
catch up with the new chat before reconciling tabs; menu focus restoration cannot interrupt it.
The tab's full surface, including its title, activity icon, and padding, drags that conversation
(tab split, stack, or join). A 36 × 38 pixel grip at the left of the tile header (matching the
browser tab strip) drags the whole pane with every tab in it; compact equal-width tabs leave no
empty header space, so the grip is the reliable whole-tile target. The overlaid close button keeps its own click action; its
hit area is a 24 × tab-height strip around the existing 11 px icon, without a larger hover chip.
Click a tab to return to its conversation; arrow keys and Home/End
also switch tabs, and Delete closes the focused tab. Only the active tab's close button is in the
tab order. Tab strips scroll horizontally when full: narrow tiles keep a 72 px floor per tab so the
strip overflows instead of collapsing labels, a wheel over the strip pans it, and selecting a tab
scrolls it into view. Mounted drafts and attachments survive
switching tabs. Each tab's close button removes it from the layout without deleting its history
or stopping a running turn. Closing the active tab selects a neighbor; closing the last tab in a
tile removes that tile when another tile remains. The workspace always keeps at least one tab.
Hidden tabs can be parked or detached by normal runtime trimming and are reattached when selected.

Chat tabs show a compact continuously rotating blue spinner while working, an amber pause icon when paused,
and a red alert icon for reported errors. A background completion replaces the spinner with a solid
green unread dot in the same position, using the persisted completion review queue; opening the chat clears that dot.
The tab's accessible name carries the same status as text; there is no hover preview. Reduced-motion
settings replace animation with a static spinner. Paused state is explicit; the UI does not
infer a request for user input from message text.

Drag an individual conversation tab onto a tile's left or right edge to show chats side by side,
or its top or bottom edge to stack them. A tab can split out of its own group, including the active
tab; sibling conversations stay in place. Drop a tab onto another chat header to join its tab strip.
The highlighted region previews the split or tab destination. These moves preserve mounted drafts,
attachments, and transcripts and persist with the project's layout.

The 36 × 34 pixel grip at the top left of the browser tab strip moves the whole shared browser. Drop it at a
chat's top or bottom edge to stack it above or below that chat, or at a side edge to dock beside
it. During a browser drag, highlighted strips at the workspace's far left and right place the
browser in a full-height column beside all chats. Moving the browser preserves its tabs and
the selected chat; its position uses the same saved layout and resizable dividers.
The drag shield leaves the browser tab strip exposed and passes pointer events through to the
layout; the native page is occluded separately so it cannot intercept the gesture.
Browser drags preview the resulting layout, including the space reclaimed from the browser's old
slot and minimum pane sizes. A solid outline and release label mark the browser's final bounds;
dashed outlines show the remaining chats. Targets stay fixed during the gesture, with a small
dead band between directions to avoid flickering. The 32-pixel workspace edge targets start below
the tab strip and carry full-height column labels. Escape cancels; dropping over the browser,
a divider, or outside the workspace leaves the layout unchanged. Preview transitions respect
reduced-motion preferences.

Drag empty chat header space onto another tile's left, right, top, or bottom edge to move the whole pane. A
highlight previews the destination. Moving a tile collapses its former empty split, and its
mounted composer, draft, attachments, and transcript scroller survive the move. Open an existing chat
through header search, then drag its tab to a tile edge to place it alongside another chat. New chats
can also be added using the split controls in each chat header.
Opening a chat from header search or Manage chat history selects its existing tab wherever it lives,
or adds and selects a new tab in the focused tile. The current chat and its draft remain in their
original tab; sibling tabs, other tiles, and divider sizes stay in place. The tab strip's + button is
the only new-chat control in a tile; the composer's + attaches files.
File → New chat and continuation also add a tab in the focused
tile; the split buttons explicitly add another tile. Moving a visible tile carries its tab group;
dragging a tab to a tile edge splits that conversation out of its group.

Dividers reserve a 14 px grab area between panes, with a center grip and hover, focus, and active
feedback. This area stays outside native browser bounds. They resize horizontal and vertical
splits independently; arrow keys resize a focused divider by 5% (Shift: 1%), and double-click
balances it within pane minimums. Escape during a drag restores its starting proportions;
pointer cancellation, lost capture, and window blur release the gesture. Nested splits support columns, rows,
and quadrants, up to 32 visible chats. A tile has a 300 × 280 px minimum; the chat area scrolls
when a small window cannot fit the chosen arrangement. Every layout uses the same one-line
composer (42 px at rest, 30 px controls). Drafts grow upward within a tile-relative height limit and
then scroll, leaving room for the transcript.
Tiles at most 680 px wide or 640 px tall also tighten transcript spacing; under 460 px the setup
trigger drops the folder name, and under 330 px the model name too. Single-tab headers use the
available width for the title; the focused tile has the accent tab indicator.
The composer is one line inside one card: attach (`composer.upload`) on the left, the text, and the
action button on the right. The setup trigger (`composer.setup`) sits beneath the card with the
model on the left and folder on the right, using matching muted text. There is no collapsed mode;
pending attachment chips sit above the line inside the card. The setup trigger opens a single panel with four
sections: Model (providers as groups, each on its most-used short list with a full-width
**Show N more models** disclosure (`composer.model-more`) for the rest), Effort (a segmented
control, `composer.effort-item`), Folder, and Context (the
context window, plan windows, and Compact conversation). Model and effort rows are disabled while a
turn runs; the folder section stays usable because a change queues until the chat is idle. The
trigger does not change while a turn runs: no spinner or elapsed clock. Right-clicking
any tile header or tab opens a context menu led by **Close tab** (`layout.tab-close`, Ctrl/Cmd+W),
then **Hide pane** (`layout.pane-hide`) and, with another tile open,
**Move tab to next pane** / **Move tab to previous pane**
(`layout.tab-move`, item `next` or `previous`) move the active conversation into the neighbouring
tile's strip in reading order, the keyboard route for a tab drag; an emptied tile collapses as it
does after a drag. Close, hide, and move rows show subtitles when tasks continue. A separator
follows, then **Workspace layout…** (`layout.presets`), **Rename…**, optional **Pin chat**, and
pause/resume when the tab’s task is running or paused. Ctrl/Cmd+W uses that same close or hide path for the focused chat.
A rejected layout operation shows its reason above the canvas, cleared by the next successful
operation or after 8 s. Adding a tab waits for main to confirm the selection; if no confirmation
arrives within 5 s the controls are released, the layout is reconciled against the current
workspace snapshot, and the same line reports it. Double-clicking a tile
header toggles maximize mode. Close/hide tooltips explain that
these actions do not stop tasks and name running or paused state when available. Successful closes
and hides show a 4.5-second status message over the focused chat, noting continuing or paused tasks
when present. The message takes no layout space and adds no controls. In maximized/solo mode, the
tile expands to 100% canvas dimensions while background tiles and the browser remain mounted and
hidden with active agent tasks running undisturbed. Pressing `Escape` or double-clicking the header
immediately restores the full split grid layout without modifying persisted divider ratios. Browser visibility and the chat tree, including divider ratios, are saved per project
in renderer localStorage, including tab order and each tile's active tab. Missing/archived chats
are removed from a restored layout; layouts saved before tabs remain compatible.

The title bar's layout menu (`layout.preset-menu`, beside Search chats) offers four one-click
starting arrangements (`layout.dock-preset`: browser centre, six chats, four chats, chat + browser)
and a **Workspace layout…** row (`layout.preset-menu-custom`) that opens the full dialog.

**View → Workspace layout…** and the tile context menu's **Workspace layout…** row (`layout.presets`)
open a dialog (`layout.presets-dialog`) with two starting arrangements drawn to scale for the current
canvas: **Browser centre** (`layout.preset-browser-centre`), the browser at 42 % width between two
stacked chats on each side; and **Chats only** (`layout.preset-grid`), the browser hidden and a
chosen number of chats (`layout.preset-grid-count`, stepper `layout.preset-grid-decrement` /
`layout.preset-grid-increment`) in a balanced grid. The grid picks columns and rows for the canvas,
preferring tiles of at least 440 × 480 px, then squarer tiles; a short last row spreads across the
full width. The count is clamped to what fits the 300 × 280 px minimum, at most 12. Each hint shows
the resulting chat size, amber when tight; the footer says how many open chats are reused and how
many are created. **Apply layout** (`layout.preset-apply`, also Enter; ←/→ switch options) keeps each visible tile's tab group in tile
order, merges surplus tiles into the last slot as tabs, creates new chats for empty slots, and
writes the result to the same per-project saved layout as any hand-built arrangement: nothing is
locked, no preset persists as a mode, and drag, resize, split, hide, and the browser grip apply to
it immediately. **Cancel** (`layout.preset-cancel`) leaves the layout unchanged.

`src/renderer/chat-layout/` owns the shared tree, geometry, persistence, and tile controls. The browser
is a reserved layout leaf, excluded from chat subscriptions, tab lists, and the 32-chat limit.
Hiding it only removes it from displayed geometry; its position and divider ratios remain saved.
Older chat-only trees gain a browser leaf on their right when restored.
`chat.setVisiblePanes(cwd, paneIds, retainedTabIds?)` registers display subscriptions and protects visible chats
from attachment trimming and blank-chat cleanup. Retained tab ids also protect empty tabs from
blank-chat cleanup without waking or subscribing to inactive tabs. It ignores stale project updates. The shared
snapshot's `panes` map contains the bounded visible views; `selected` remains the focus view for
existing consumers. Hidden panes retain their main-process state but do not stream text over IPC.

## Chat surface

- Dark-theme chat panels use a neutral near-black (`#181818`) canvas, with neutral
  charcoal (`#1c1c1c`) user cards, composers, and active tabs. These colors are scoped
  to chat so the window header and browser keep their own surface colors. Chat and
  browser tab headers share the same shell chrome background (`#141415`), with a
  lighter neutral gray (`#242424`) workspace background around both shells.
- The window header has a soft charcoal (`#181819`) background in the dark theme.
  It is 44 px tall, with 14 px menu/search text, a 34 px search field,
  a 24 px textured Earth browser globe with a 15° axial tilt and a subtle brightness lift on hover,
  and enlarged window buttons. Its locally bundled texture rotates continuously once per 24 seconds
  and pauses while the document is hidden. Reduced motion
  disables rotation and the 140 ms brightness fade. A local PNG remains the loading/failure fallback.
  The shell reserves the header's
  natural height so the workspace begins directly below its divider.
- Header search reads chat records across directories, attached or detached, including child chats.
  It matches titles; project names provide context. Opening a result calls `openChat` and selects
  an existing tab or adds a new tab to the focused tile. Archived chats are excluded by the store.
  Running results show a status label and Pause button; paused chats stay in a Paused section
  with a Resume button. Both actions target the row without opening the chat and use the same
  interrupt/continuation behavior as the composer. Pauses do not count as unread completions.
  Tab completion indicators retain their persisted review
  marks; opening the chat clears its unread mark. The old directory/pin/review sections, New Agent
  button, drawer toggle, and sidebar row menus are removed. Saved records and pin metadata remain.
  History, new-chat, and title-action failures appear below the header search for eight seconds.
- Credential approval card (`credential-approval-card.tsx`, off by default): with Settings → Security →
  "credentials require approval" on, an agent's request to read a saved secret appears above the
  composer of the chat that asked (orphaned requests fall to the selected pane) with the credential,
  its fields, the agent's reason as plain text, and Allow/Deny (`chat.credential-allow`,
  `chat.credential-deny`, keyed by request id); `security-requests.ts` is the one seam to the bridge.
  `listChats` answers from the store at once, then reconciles the providers' thread catalogs in
  the background (adopting threads the store has not seen, cached five seconds, invalidated on turn
  end, archive, open, and project switch; a scan that lands after a project switch is dropped).
  Peer-summary updates are throttled to 200 ms during streaming and a pending update is flushed on
  stop. Summaries update from events, carry `running` from one source (the hub's active turn),
  never reset a title to a placeholder on a wake, retain transcript order during late tool updates,
  and cap previews at 240 characters. The selected and visible panes' events cross chat IPC; main-process
  transcripts and trace observers still receive every pane's events. Registering visible panes
  delivers bounded snapshots before subsequent deltas, with actions and history pages routed by
  pane id. Focus changes preserve earlier pages already loaded in other visible panes. History activity uses a separate snapshot
  that stays stable during text/output deltas, keeping its row calculations out of the token stream.
- Adjacent text/output deltas for a visible pane are coalesced for up to 8 ms before chat IPC;
  every other event flushes the pending delta first, preserving transcript and turn ordering.
  Turn trace records one `chat.ipc` measurement per fully observed turn and shows renderer
  messages sent versus visible events received, delta counts, and streamed characters.
  Chat events are then batched by animation frame. Markdown renders that frame's current text without
  another timer, including the final chunk when a task completes. Code highlighting remains
  throttled to 250 ms and limited to 20,000 characters, but pending highlights show the current
  plain code rather than an older highlighted version.
- Displayed assistant text is paced (`components/ui/paced-text.ts`): the painted prefix trails the
  received text at a reveal rate that eases toward the arrival rate (over ~420 ms) rather than
  tracking the momentary backlog, so single-token, sentence-burst, and whole-message chunk cadences
  (Antigravity can deliver a step's text only on its DONE half) paint as one typewriter at a steady
  speed — a rate proportional to the backlog instead surged on every chunk and crawled between them.
  The lag it holds follows the tracked gap between chunks, clamped to 180–700 ms: about one chunk of
  lag is what lets a steady rate span the gap between two of them without emptying and waiting, and
  a backlog older than 700 ms drains whatever the rate has adapted to, so the reveal cannot fall
  behind a fast stream or stall an interrupted one. A streaming message that mounts with bulk text —
  a pane becoming visible mid-turn — sweeps in instead of popping. Settled items, replaced text
  (a repair that does not extend the shown prefix), and reduced-motion sessions render in full
  immediately; a turn whose item never settles still finishes because the drain does not depend
  on the settle event. While text is revealing, the trailing markdown block's unfinished inline
  syntax — `**bold`, inline code, `~~strike~~`, half-typed links and images — is closed or held
  back before lexing (`components/ui/markdown-stream.ts`); settled text renders exactly as written.
- Sending a prompt anchors it at the top of the transcript viewport
  (`MessageScrollerProvider` `anchorPrompts`, `chat-pane.tsx`): a trailing spacer holds the
  position before the response exists, the reply streams in below without moving the viewport, and
  the beginning of a long answer stays readable instead of scrolling away. Scrolling releases the
  anchor without collapsing its spacer (removing it mid-gesture clamps scrollTop and teleports the
  reader); reaching the bottom resumes follow-to-bottom for the rest of the turn, and the next
  prompt re-anchors. A prompt only counts as newly sent while it is the newest transcript row, so
  provider replays and pane wakes that re-materialize the last prompt with its response below it
  never move the viewport. Opening a chat still mounts scrolled to the end, and revealing earlier
  history still preserves the reading position. Native `overflow-anchor` is disabled on the chat
  viewport because the scroller owns every correction.
  Anchor measurements convert rendered geometry back into transcript coordinates at chat zoom,
  retaining fractional row heights. Trailing space is calculated from the actual last row and
  padding rather than the viewport's minimum height, so it settles in one correction and does
  not feed its own size back into subsequent streaming updates. The real-app regression check
  (`npm run build && xvfb-run -a node scripts/chat-scroll-live-check.mjs` on Linux) supplies
  deterministic chat events through the existing preload in a disposable profile and checks
  streaming at 50–250% zoom, manual scrolling, bottom following, new prompts, and resizing.
  The scroll-to-first-message button stays hidden until the user scrolls upward, and hides
  when they scroll downward or reach the top. Opening a chat and automatic positioning do not
  reveal it.
- The renderer initially receives the latest turn. "View previous messages" reveals one earlier
  turn at a time and keeps at most three turns mounted; scrolling back to the bottom trims
  prepended history from renderer state. Older pages fetch by stable item id; stale responses
  after a chat switch are ignored. The mounted display boundary also uses a stable row identity,
  falling back to the latest turn when a snapshot removes that row, so trimming cannot leave
  streamed messages hidden behind an out-of-range row offset. Earlier-page reveals apply once.
  Provider sessions and the main-process transcript remain complete for continuation,
  branching, and peer reads; this is display paging, not model compaction. Codex history replay
  emits one replacement instead of streaming old items again.
- The model menu is two columns in one panel: providers on the left, one row each, naming the
  model in use where that provider owns the selection, and the hovered provider's models on the
  right. It opens on the selected model's provider; hovering, focusing, or selecting another
  provider row switches the right column without closing anything. The selected model's
  reasoning efforts sit under the provider list, since they belong to the selection rather than
  to a provider. The models column opens on that provider's top few models, ranked by locally
  recorded picker use and always including the selected one, with the rest one row away; a
  single remaining model is shown rather than hidden. The panel is one fixed width, bounded by
  the chat pane it is given as a collision boundary, so the picker never reaches over the
  browser column and never triggers the freeze-and-still path that a DOM overlay across the
  divider requires; that is also why the models are a column inside the panel rather than a
  flyout beside it.
- Tool activity is grouped into expandable step lists with arguments, output, status, and timing
  when available. Collapsed headlines use short phrases and file names, not full paths or line
  ranges; expanded steps keep the file name on the line and the full path on hover and in the
  invocation. File modifications display interactive diff viewers supporting unified and
  side-by-side split modes, collapsible hunks with expand/collapse all, individual hunk copying,
  and proportional addition/deletion statistics. Provider-native background tasks have a separate
  transcript group; there is no separate status strip above the composer. A turn ending does not prove that all background tasks
  finished: while any spawned task is still live the pane stays in its running state (composer
  shows Pause, response actions wait, drawer treats it as busy) until the provider's follow-up turn
  completes, and Pause between turns retires the process, marking those tasks stopped.
- Completed assistant responses offer copy and branching. Timestamps appear when recorded;
  older history does not acquire invented timestamps.
- There is no project rail: the folder lives in the composer's setup panel. The title bar has four menus.
  File owns chat creation, history, Settings (Appearance, Models, Credentials, and Security tabs), and closing the
  window; View owns browser visibility, layout, chat zoom, and fullscreen; Agent owns what the
  model is given (Tools & capabilities) and a "Selected chat" section naming
  the pane its rows act on (Compact context, Stop turn; rows that do not apply are disabled, not
  hidden); Developer owns Turn trace, Reload renderer, and Toggle DevTools.
  Shortcuts: Ctrl+Shift+T tools, Ctrl+Shift+I trace, Ctrl+R reload, F12 DevTools.
  Send, pause,
  and resume controls live in the composer; Pause and Resume also appear in header search rows.
  Pause ends the provider turn — no protocol can suspend
  a generation and restart the same one — but every lane keeps the partial answer and the
  conversation, so Resume is an ordinary next turn carrying `CHAT_RESUME_PROMPT`. It is offered
  from the turn's `paused` event until the next turn starts. Codex sends `turn/interrupt`, Claude
  the SDK's `interrupt`, Cursor the `session/cancel` **notification** (as a request cursor-agent
  ignores it and streams on), and Antigravity, which has no interrupt, kills its process and
  resumes the conversation id on the next turn. Antigravity sends the user's prompt directly
  on process startup; it has no hidden initialization turn. The composer's one action button is
  Send (`composer.send`, accent-filled once there is text or an attachment; Enter also submits and
  Shift+Enter inserts a newline), Pause (`composer.stop`) in the same slot while a turn runs
  (Escape also acts as a hotkey to pause the running task), and Resume (`composer.resume`) after a
  pause. An empty composer shows the muted placeholder “Message <Provider>”, “Resume, or send
  something new” after a pause, and nothing while a turn runs so the pause button carries that
  affordance. Typed drafts naturally hide the placeholder;
  connection/unavailable messages retain precedence while idle. The textarea label, the disabled
  placeholder, and the pause/resume tooltips name the pane's provider. Before the first snapshot
  the workspace area shows “Starting ClosedAI…”, or “Could not start” with the reason and Retry
  when the snapshot request fails. A pane whose provider cannot take a message shows connection
  guidance (`chat-connection.tsx`): the empty pane's heading is “Sign in to <Provider>”,
  “<Provider> is unavailable”, or “Starting <Provider>…” by connection state over main's message
  (install steps, sign-in path, or failure), with Sign in with ChatGPT for a signed-out Codex pane
  and a “Choose model” hint that opens the setup panel for every blocked state. A blocked empty
  pane also reads `chat.providerAvailability()` once and lists each provider as Installed or Not
  installed, so a missing CLI on first run does not hide the providers that would work; a failed
  read leaves the message-only state. Once a transcript
  exists the same guidance is a strip above the composer instead of replacing the messages.
  Failed pause, model, and effort changes appear in the composer's alert row; a failed compaction
  or refused shell shortcut appears as a dismissible notice. Compact conversation is available from
  the setup panel's Context section (`composer.compact`) and Agent → Compact context when the provider supports manual
  compaction. The composer preserves unsubmitted drafts (text and pending attachments) per
  conversation pane across tab switching and unmounting, clearing them only on submission.
  Appearance settings separate message and composer font sizes
  (defaults 14 and 15 px, range 13–22) from chat zoom.
- Ctrl/Cmd+, opens settings, Ctrl/Cmd+H opens chat history, Ctrl/Cmd+N creates a chat,
  Ctrl/Cmd+W closes the focused chat tab or hides its tile (same path as the ×; the last
  remaining chat stays), Ctrl/Cmd+Shift+W closes the window, F11 toggles fullscreen, and Escape
  pauses a running task in any pane. Escape yields (`escapePausesTask` in
  `renderer/app-shortcuts.ts`) when a dialog, menu, or popover is open, when any input, textarea,
  or editable element other than the composer textarea has focus, when a tile is maximized (the
  tile carries `data-solo`), or during a pane drag (`data-layout-drag` on the canvas) or divider
  resize (`data-layout-resize` on `body`); those owners handle it in the bubble phase, which the
  shell no longer stops. Browser and chat zoom have separate controls; these shell shortcuts are
  handled in `renderer/app-shortcuts.ts`.
- Every http(s) URL a response references is clickable and opens in the app browser through
  `browser.openTab`, rendered as a favicon source chip with a hover preview. `components/ui/markdown.tsx`
  runs `remarkBareUrls` (`markdown-links.ts`) after remark-gfm so scheme-less hosts such as
  `example.com/path` become links too; the transformer skips code, existing links, and hosts outside
  its curated TLD list, which is what keeps `chat-transcript.tsx` and `package.json` as plain text.
  Explicit absolute local file links (including `file://` and optional line suffixes) are
  clickable in chat responses. Raster images open in browser-pane image tabs through a
  bounded 32 MB read; other files open in an inert text viewer with a bounded 5 MB read and
  line highlighting. Binary files show a preview error; directories are revealed in the file manager.
  Files are never executed. Missing files and preview failures show an error. Other non-http schemes stay
  inert. This holds for every provider lane.

Provider background tasks and app panes are separate concepts. Claude tracks task notifications
across turn boundaries with `ClaudeBackgroundTasks`; Codex collaboration items are marked as
background agent activity. The read-only `peer_chats.list(scope=open)`/`read` directory exposes other panes and visible
subagent summary items, not an independent process-control API for every SDK task. `read` answers
"what is that pane doing" first: it pages from the newest item backwards, keeps a page inside a
serialized character budget by clipping long tool detail, output, diffs and screenshot data URLs,
and reports `totalItems` so a caller can place the page. `order: "oldest"`, `types` and `max_chars`
cover the rest; reasoning items still never cross into another pane.

## Browser surface

`BrowserService` owns a `WebContentsView` per tab and one `persist:browser` partition. Cookies,
login state, history, and downloads are app-wide. The initial cookie import runs before the first
page load. Tab state and history are persisted separately.

Page permission requests follow `Settings ▸ Security ▸ Web permissions` (`src/main/browser-permissions.ts`).
The default, `allow`, is the historical policy: every Chromium permission request, permission check,
and device request is granted, `getDisplayMedia` takes the first screen or window source, and the
HID, serial, USB, and Bluetooth pickers choose their first candidate without prompting. `block` denies
the four prompts Chrome shows — camera/microphone (`media`), screen capture, location, and
notifications — plus device access and the pickers, while clipboard, fullscreen, pointer lock, and
the rest stay granted as Chrome grants them without a prompt. `ask` routes those four kinds through
`BrowserPermissionBroker` (`src/main/browser-permission-broker.ts`): the pending list reaches the
renderer on `browser:permissionRequests` with the tab id, origin, and kind, `browser.resolvePermission`
answers it, and an unanswered request is denied after 60 s. The policy is read per request, so a
settings change applies to the next request without a restart. Nothing else is remembered per origin.

On Linux, startup disables accelerated video decode by default because affected driver stacks can
accept and advance H.264 playback while compositing blank frames. This leaves GPU compositing and
WebGL available; only media decoding falls back to software. A known-good machine can opt back in
with `CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE=1`, while
`CLOSEDAI_DISABLE_HARDWARE_VIDEO_DECODE=1` explicitly keeps the safe default.

The omnibox combines navigation/search input with inline completion and a history suggestion
list. History matches can be removed through `browser.removeHistory`; this deletes the stored
history entry, not cookies or site data. `browser-omnibox.ts` owns the renderer interaction and
`browser-history-store.ts` owns matching and persistence.

Right-clicking a browser tab opens tab actions for opening a new tab to its right, reloading,
duplicating, renaming, closing, closing other tabs, and closing tabs to the right. The menu also
opens from the ContextMenu key or Shift+F10 on a focused tab; its first row takes focus, Up/Down
and Home/End move between rows, and Escape or a chosen row returns focus to the tab. A tab or
navigation command the main process rejects shows its reason on one line under the tab strip,
dismissed by its button (`browser.notice-dismiss`) or after 8 s. Custom tab
names are tab-strip labels stored separately from the page title and are persisted with the tab
session.

Web permission bar (`web-permission-bar.tsx`, off by default): with Settings → Security → web
permissions set to Ask, a page's camera/microphone, screen, location, or notifications request
shows as one line under the tab strip for the active tab only, with Allow/Block
(`browser.permission-allow`, `browser.permission-block`, keyed by request id); requests for other
tabs wait for their tab and expire in main after 60 s.

All page-requested windows become regular browser tabs, including OAuth/login windows, sized
utility popups, and `about:blank` children. Electron's `createWindow` callback hands the original
child WebContents to a WebContentsView, preserving native opener/postMessage behavior, named
window reuse, blank-document writes, redirects and form POSTs. Background-tab dispositions stay
unselected; Chromium-deferred children without supplied WebContents receive one explicit initial
navigation. Tabs fill the browser pane rather than using a site's popup dimensions, remain open
when their opener tab closes, and support the usual capture, input and CDP tools. Page-initiated
`window.close()` removes the tab. Public research workers deny popup creation entirely.
The isolated regression check is `xvfb-run -a node scripts/popup-tabs-live-check.mjs` on Linux;
it exercises the real BrowserService and Chromium without the user's profile. Verified on Electron
44.1.1; this replaces the former Electron 43 native-window workaround.

The page view fills every compositor gap — between a navigation committing and the new
document's first paint, and whenever a hidden view is shown again — with one flat base colour.
That colour is not fixed. `browser-page-background.ts` measures each document's real canvas
colour at dom-ready and remembers it per origin, and the next gap on that origin is filled with
the colour the page is about to paint, so a gap is not a flash. A tab holding no document shows
the app's bezel colour, and a page that paints no background of its own still gets the browser
default of white. The renderer's overlay freeze waits for its still, then moves the still-compositing
native page entirely left of the window instead of toggling its visibility, so chats docked
beside the browser are never covered by the parked page; `browser:setBounds` waits
for a painted frame before resolving the return. This avoids both a blank capture gap and Electron's
loaded-view blanking failure when a `WebContentsView` is hidden and shown around an overlay.
Modal backdrops participate in this overlap check. Image previews instead own a tab in the
shared strip: `local-files/image-tab.ts` holds the image without a native browser view, and
selecting it parks all native web views beyond the window before emitting renderer state.
The app renderer displays fit-to-pane, zoom, actual size, drag-to-pan, download (raster data),
and show-in-folder (local files) controls. Image bytes are fetched once per viewer, separately
from tab metadata. Local image links and attachment thumbnails use this image viewer, while
other local file links open in app-owned text tabs so that source and text files get line
highlighting instead of Chromium's plain-text rendering (Chromium's own PDF viewer still handles
PDF URLs in web tabs). File tabs support copy path, copy content, show in folder, reload, duplication, and
line highlighting; reopening a link updates its line target. In both cases, opening one
reveals a hidden browser pane and exits maximized chat layout. Reopening the same canonical
file or attachment source selects its existing tab. Directories reveal in the system file
manager. Closing an image returns to the previously selected tab when it is still open. Switching
preserves the image's zoom/pan and the web page. Image and file tabs are session-only; they do not
restore after app restart. Browser page/CDP tools operate on web tabs, not the app-owned
image or file viewers; their controls use `closedai_app.ui`.
Hiding the whole browser also keeps user tabs attached and parks the active surface beyond the
window at its last usable size. Reopening restores that same loaded page without a reload;
zero-size reports during panel collapse or expansion never replace the saved viewport. Keeping
these surfaces resident trades background rendering work for reliable restoration.

Browser-page captures watch main-frame navigation and renderer lifetime from before the
readiness wait until the image returns. Navigation (including reload and same-document changes)
or renderer loss discards the image with a retry message; listeners and rendering leases are
released on success and failure. This guards page attribution, not atomic DOM/pixel coherence:
DOM updates, animations, canvas/video, and subframes can still change during capture. The
capture therefore also reports what it can honestly claim: the readiness-to-pixels interval, how
the frame was established (painted for a visible document; settled or unsettled from consecutive
captures of a hidden one, whose animation frames are paused; unconfirmed when a visible page did
not paint), the DOM mutations counted meanwhile, and a verdict the model reads as verified or
unverified evidence. See [Tools](tools.md) for the measured rules.
After a navigation becomes usable, and again when loading stops, the tab reasserts its unchanged
bounds and visibility. This revives Electron's frame sink when a redirect leaves DOM/CDP alive
but the attached native surface blank.

Browser inspection can read a background HTML tab without selecting it. Chromium throttles hidden
pages to ~1 Hz timers with no animation frames. `browser-tab-cadence.ts` exempts a tab while a tool
operates on it and for 5 s afterwards; navigation holds the exemption across load. A runtime
`setBackgroundThrottling(false)` restores 50 ms timers and 60 fps rAF while `visibilityState` stays
`hidden`. Capture temporarily disables background throttling and restores it afterward. When the
browser is collapsed or covered, a temporary never-shown native window can host the same view for
capture and return it afterward.

For native PDF text, select the PDF tab,
then `embedded_browser.page read_page` reads `pdf_page` (one-based, default 1) from Chromium's
already-loaded PDF accessibility tree. It uses a temporary sandboxed diagnostic WebContents,
without refetching the PDF, selecting text, or running OCR. The helper owns and releases its
scoped accessibility state. This internal Chromium interface is version-sensitive; see
[Tools](tools.md) for verification and limits. Scans may have no native text. Existing browser
capture supplies the visible page image when figures or layout matter. Native text is not
a correctness or visual-verification claim.

Semantic page input brings the tab forward, waits for rendering after a switch, and reports
`activatedTab: true`. It fails
if the browser page cannot be shown. Captures use a rendering lease and readiness checks;
shared frame settling lives in `browser-frame-settle.ts`. See [CDP](cdp-tool-foundation.md).

Tab ids are persisted with the tab session and restored under the same id
(`reserveTabId` moves the counter past every restored id), so a model's `tab_id` from before a
restart still names the same page. A stale or unknown id fails with the open tabs listed
(`describeMissingTab` in `src/shared/browser-tabs.ts`), the same message from the page, capture,
CDP, and navigation paths, so the next call can pick a live tab without another lookup.

Because the app owns the session, it records the browser without a debugger.
`src/main/browser-network/` holds that: `BrowserObservers` installs a session-level network
observer on Electron's `webRequest` stages (every request from every tab with headers, status,
timing, redirects, post data, and a rule engine that blocks, redirects, or rewrites headers at
the blocking stages) and attaches a per-tab console capture on `console-message` with navigation
markers. The request-header stage is shared with identity normalisation in
`browser-auth-client-hints.ts`, which composes the rules through its injector because Electron
keeps one listener per stage. `browser-network-access.ts` exposes the log, rules, session fetch,
and cookies to the `embedded_browser.network` and `session` tools; `browser-page-evaluate.ts`
runs `query` and `evaluate` through `executeJavaScript` on the tab's WebContents. Historical
response bodies are read only through exact CDP request/session ids. The separate
`embedded_browser.network_replay` tool deliberately resends a recorded request on the current
session, labels its result as new evidence, and refuses incomplete or binary upload bodies.

For exact captured-response work, `browser_cdp.protocol requests` preserves repeated URLs
as separate requests and reports child session ids. It leases `Network.enable` into every
attached frame and worker target, including ones that attach later, so cross-origin frame and
worker traffic is captured under its own session id; `childSessions` reports how many children
are capturing and which refused. Its `body` action accepts `session_id`
and reads that target's buffer without reissuing requests. Resource-timing URLs remain
discovery hints and are not used to fill guessed fields on individual captured requests.
The session-level body action and guessed URL/method association have been removed.

Instrumentation does not wrap eval or Function, preserving direct eval's lexical scope.
The current document's recorder reports installed/unavailable patches. Unhook disables retained
wrapper references, restores descriptors still owned by the recorder, and removes its listeners;
page replacements are preserved and restoration failures reported. The recorder is also leased
into every cross-origin frame target: frames present at hook time get it immediately, and a frame
created afterwards starts paused, receives it, and only then runs its first script. `recording`
folds each frame separately under `frames`, and `unhook` removes it from each frame and reports
per-frame outcomes. Workers are not recorded. Wrappers remain observable. This is not transparent
instrumentation.

## Ownership map

| Concern | Source of truth |
|---|---|
| Bootstrap, service composition, project persistence | `src/main/index.ts`, `src/main/app-settings-store.ts` |
| Launch fault handling, renderer-loss recovery, bounded quit | `src/main/app-crash-guard.ts`, `src/main/main-window-recovery.ts`, `src/main/app-quit.ts` |
| Provider install detection and missing-binary messages | `src/main/provider-availability.ts`, `src/main/provider-binary.ts`, `src/shared/provider-availability.ts` |
| Chat records and persistence, settings migration | `src/main/chat-store/`, `src/shared/chat-store.ts` |
| Store file reads that set a damaged file aside, durable atomic writes | `src/main/store-recovery.ts`, `src/main/atomic-write.ts` |
| Attach/detach lifecycle, summaries, per-chat settings, idle parking, catalog reconciliation | `src/main/chat-peers/` |
| Per-workspace provider model catalog cache | `src/main/chat-context/provider-catalog-cache.ts` |
| Provider routing and id families | `src/main/chat-hub.ts`, `src/shared/chat-providers.ts` |
| Workspace Codex process, pane routing, and transcript normalization | `src/main/codex-workspace-runtime.ts`, `src/main/chat-service.ts`, `src/main/app-server-client.ts`, `src/main/chat-normalizers.ts` |
| Claude / Antigravity / Cursor sessions and translation | `src/main/claude/`, `src/main/antigravity/`, `src/main/cursor/` |
| Model context, trust and handoff | `src/main/chat-context/`, provider session adapters |
| Provider-neutral tool definitions and execution | `src/main/tools/` |
| CDP retain receipts, worker storage | `src/main/investigations/`, `src/shared/investigation-artifacts.ts`, `browser_cdp.protocol` retain |
| Deterministic app commands and renderer control access | `src/main/app-commands.ts`, `src/main/app-automation-*.ts`, `src/shared/ui-controls.ts` |
| Browser, history, popups, CDP sessions and input | `src/main/browser-*.ts`, `src/main/cdp/` |
| Session network record, interception rules, console capture, session fetch and cookies | `src/main/browser-network/`, `src/main/browser-network-access.ts` |
| Stored API keys and logins, OS-keychain encryption | `src/main/credential-vault.ts`, `src/main/safe-storage-encryption.ts`, `src/shared/credentials.ts`, `src/renderer/settings/credential-*` |
| Security settings, credential approval cards, page permission requests | `src/main/security-settings-store.ts`, `src/main/security-ipc.ts`, `src/main/security-approvals.ts`, `src/main/browser-permission-broker.ts`, `src/main/decision-broker.ts`, `src/shared/security.ts` |
| Default-browser cookie import (launch and on demand) | `src/main/browser-cookie-import.ts`, `src/main/import-cookies.ts` |
| Typed IPC contract and narrow preload | `src/shared/api.ts`, `src/preload/index.ts` |
| Chat/project/history orchestration | `src/renderer/chat-pane.tsx`, `src/renderer/project-menu.tsx`, `src/renderer/chat-history/` |
| Transcript steps, background work, response actions | `src/renderer/transcript-rows.ts`, `src/renderer/activity-steps.ts`, `src/renderer/background-tasks.tsx`, `src/renderer/message-actions.tsx` |
| Reusable presentation and scrolling | `src/components/ui/`; backend access stays outside this layer |

`src/shared/` remains dependency-free. Renderer backend calls go through preload; model calls go
through the main-process registry. Interactive controls use manifest ids, not model-invented
DOM selectors. The generated workspace index is a maintenance artifact; it is not injected into model context. See [Tools](tools.md) and [Model context](model-context.md).

## State and retention

Selected protocol results can be retained through `browser_cdp.protocol command` with
`retain: true`, `tab_id`, `operation_key`, and `label`. The private
`investigation-artifacts/artifacts.sqlite` database stores bytes, metadata, and operation
receipts in a worker. Retained data belongs to the caller's stable chat id and project
directory, survives navigation/model changes/restart, and is not removed by pane parking or
hiding. Retention is explicit; normal tool results are not automatically archived. There is
no model-facing list/read/export/delete surface beyond the compact receipt and same-key retry
semantics. See [Tools](tools.md) and [CDP tool foundation](cdp-tool-foundation.md).

File operations use native provider tools. No custom workspace inspection tool, generated map
injection, native-read interception, or automatic source-version check runs around a turn.
Browser tools, credentials, and chat controls remain available through the shared registry.

App-owned files live under Electron's `userData` (`~/.config/closedai/` on Linux by default).

| Store | Contents |
|---|---|
| `provider-catalogs.json` | The last model catalog read per workspace and provider, so a relaunch starts only the active provider and the picker still offers every model; a provider refreshes its own entry when selected |
| `chat-transcripts/<chat id>.json` | The bounded tail of each chat as the app last showed it, so opening one paints before its provider replays; display-only, pruned against the store's live chat ids on launch |
| `chats.json` | Every chat record: id, project directory, provider, model and effort, per-provider thread ids, title, preview, created/updated/last-turn times, archived flag, pin timestamp, parent chat, continuation digest, checkpoint. Debounced atomic writes; flushed on quit |
| `app-settings.json` | Cookie-import latch; active workspace/project; the open chat ids (`chatOpenIds`) and `chatSelectedPaneId`; saved per-project open ids and selection in `chatWorkspaces`; tool switches and context/batch settings. Legacy `chatPeers` and `chatWorkspaces[].peers` are imported into `chats.json` once, keeping each pane id as the chat id, and removed |
| `browser-tabs.json`, `browser-history.json` | Restored tabs and omnibox history |
| `Partitions/browser`, `code-cache/` | Chromium session data and app-configured code cache |
| `browser-cache-state.json` | Last measured regenerable browser cache size and prune timestamp; when Cache + Service Worker + GPU caches exceed 768MB and the seven-day cooldown has elapsed, startup and periodic maintenance clear only regenerable stores (cookies, localStorage, and IndexedDB stay intact) |
| `tool-telemetry.json` | Aggregate run/error/timeout counters; no arguments or conversation text |
| `security-settings.json` | Settings ▸ Security: `credentialsRequireApproval`, `secretsRequireKeychain`, `webPermissions`, `importBrowserCookies`. A missing file is every default, which is the behavior before the tab existed; an unreadable one is set aside as `security-settings.json.corrupt-<time>` and never overwritten |
| `credential-vault.json` | Saved credentials: service id, entry label, timestamps, per-entry `agentAccess` (absent on older records, read as on), and one record per field. Secret fields are `safeStorage` ciphertext (base64); hosts, usernames and URLs stay readable so the list renders without decrypting. Written atomically at 0600. Only a missing file is an empty vault; a file that cannot be read is set aside as `credential-vault.json.corrupt-<time>` before the vault continues empty, so the next save never overwrites it. Entries the earlier localStorage vault held are moved here on first open and the localStorage copy is cleared only after every entry lands |
| `antigravity/profile/`, `antigravity/attachments/`, `antigravity/transcripts/` | Generated agent plugin, materialized image attachments, and app-recorded transcripts; the CLI retains its own conversation store |
| Renderer localStorage | Appearance, model-picker usage, completion review queue (including review time; legacy storage key retained), message timestamps |
| In-memory trace | At most 4,000 entries and 24,000,000 detail characters, 48,000 characters per detail before its truncation marker; cleared on restart |

Only a missing store file means a fresh start. When `chats.json`, `app-settings.json`, or
`browser-tabs.json` cannot be read or parsed, the file is renamed beside itself to
`<name>.corrupt-<timestamp>`, one warning names that copy, and the store starts from defaults, so
the next debounced write never replaces the only copy of the user's data. Store writes reach the
disk (`fsync`) before the temp file is renamed into place. A `credential_vault.read` result never
enters `chat-transcripts/` or the Antigravity transcript copies: the model receives the values,
and the transcript's tool row keeps `[credential values withheld from the record]`.

Legacy top-level `chatThreadId`, `chatClaudeSessionId`, `chatAntigravityConversationId`, model,
and effort fields coexist with chat records. New code should use `PeerSettings` (a projection of
the chat record) for a chat's settings, not assume those top-level fields describe every chat.
Provider session history lives in each provider's own store; closing a pane, archiving a chat, and
archiving a provider thread are distinct operations.

Codex-specific settings are `chatCompactAtPercent` (default 80), `chatCompactAtTokens` (default
28,000, between-turn token threshold; 0 disables), and `chatMidTurnCompactTokens` (default zero,
leaves the CLI's limit). The percentage and between-turn token triggers are independent; setting
both to zero disables app-triggered compaction. Window-percent triggers wait 15 seconds of idle
time; the token trigger waits 8 seconds;
a new send cancels it if it has not started. Repeated token-triggered compactions require three
minutes and at least max(3,000, 15% of the configured budget) token growth since the lowest usage
observed from the last attempt onward. Window-percentage pressure bypasses the token retry
cooldown and growth requirement, but still observes the idle grace. A compaction already in
flight can block the next send until it completes or the 90-second app wait expires.
This is a soft trigger, not a hard context cap or a guarantee that native compaction reaches the
target. With `chatSeamlessRotation` enabled, the same idle thresholds rotate Codex and Claude to a
fresh provider thread with a thin seed instead of calling native compact; the Turn trace records
`session.rotated` and the UI stays unchanged. Claude otherwise keeps SDK-native automatic/precomputed
compaction; Antigravity manual re-seed compaction is hidden while seamless rotation is on.
Mid-turn Codex native compact overrides are also skipped when rotation is enabled.
Provider history is not deleted; rotation leaves the old thread in the provider store for recall.

The Turn trace shows send-to-first-assistant-text timing for all four providers: preparation,
Codex's measured compaction wait (a subset of preparation), and time after provider dispatch.
The clock starts when the pane manager receives Send, before waking the pane. It ends when main
receives non-empty assistant text, including commentary, not when the renderer paints it. Provider
queueing, reasoning, tools, and internal compaction are not individually separated after dispatch.
See [Tools](tools.md) for configuration and measurement limits.

`toolBatchMaxCalls` defaults to 16, is clamped to 1–64, and takes effect on app startup.

## Credential vault

`File ▸ Settings ▸ Credentials` opens the app's store of API keys and logins. The fixed-size dialog keeps
the vault list and create form at the same dimensions. Entries render as a card grid — brand mark
on a 44px tile, entry name and service tag, the service description, its fields with masked
secrets, and a state dot showing whether the OS keychain encrypted them — closing on a dashed
`Create new` tile. An entry the catalog has no brand mark for wears the icon of the site its URL
field points at. Reveal and copy each ask the main process for that single field, so the renderer
never holds more plaintext than the user asked to see. `Remove` hides the card at once and leaves a
`Removed <name>. Undo` row for six seconds; the vault is only asked to forget the entry when that
window elapses or the Credentials panel closes, and a removal the vault refuses brings the card
back with the reason on it.
Each card carries an `Agents can use this` switch bound to the entry's `agentAccess`; turning it
off makes the `credential_vault` tools refuse that entry, and a refused change shows its reason in
the card's error slot.
`Create credential` replaces the list in place with one editor. Pasting a service URL selects the
service that claims that host, names the entry after it, and fills any URL field it has; a host no
catalog service claims becomes a Custom entry named after the domain, wearing that site's own icon
fetched as an `<img>` probe (DuckDuckGo, then Google, then the site's `favicon.ico`, then a
monogram — so only the typed domain leaves the app, and a miss degrades instead of failing). The
service can also be picked from the chip grid, which swaps the field set to whatever that service
takes. The form validates the catalog's required fields and saves directly; there is no review step.

Every provider receives the same `credential_vault` model tools. `list` discovers saved entries
and masked field ids without decryption; `read` requires the chosen credential id, exact field ids,
and a reason before returning only those values to the requesting model. Sensitive reads cannot run
inside `tool_batch`, and their Turn Trace result is redacted. The current native-provider
baseline adds no ClosedAI behavioral instructions about credential use.

The service catalog in `src/shared/credentials.ts` is the single definition of which fields a
service takes, which are required, and which hosts select it, so the store validates every saved
draft and the form renders and detects from the same source. `CredentialVault` encrypts
secret fields with Electron `safeStorage` before writing;
`safeStorage` is injected rather than imported, which is what lets `credential-vault.test.ts`
exercise the round trip outside Electron. When no OS keychain is available the vault still works
but says so — the create form warns before saving and the saved row carries an `Unencrypted`
badge — rather than silently degrading. A decrypt that fails against a changed keyring raises
instead of returning ciphertext as if it were the secret. On Linux, Electron reports encryption as
available for the `basic_text` backend too, which protects nothing; `safe-storage-encryption.ts`
reports that backend as unavailable so the badge and each entry's `encrypted` flag are honest.

`Settings ▸ Security` adds the user's choices on top, each defaulting to the behavior above
(`src/shared/security.ts`, persisted in `security-settings.json`). Every saved entry carries an
`agentAccess` switch, on by default; `credentials.setAgentAccess` turns it off and
`credential_vault.read` then refuses that entry with a message that points the model at the
setting. With `credentialsRequireApproval` on, each `read` first posts a `CredentialApprovalRequest`
(pane, credential, field ids, the model's stated reason) through `security:credentialApprovals`; the
tool waits for `security.resolveCredentialApproval`, refuses on deny, and an unanswered card is denied
after 120 s; the tool's own timeout is longer, and a call the registry aborts withdraws its card. With
`secretsRequireKeychain` on, `CredentialVault.save` refuses a draft with a secret field whenever
encryption is unavailable instead of storing it plainly. `importBrowserCookies` gates only the launch
import; `security.importCookies` runs the same import on demand regardless of the latch and returns
its counts, with `source: null` when no supported browser profile exists.

## Settings → Security

`File ▸ Settings ▸ Security` holds the user's manual choices from `src/shared/security.ts`; every
default is the unrestricted behavior the app has always had, so a user who never opens the tab sees
no prompt or block. Three groups: **Credentials** — `Ask me before an agent reads a credential`
(`credentialsRequireApproval`) and `Only save secrets when the OS keychain is available`
(`secretsRequireKeychain`); **Browser** — a segmented Allow / Ask / Block control for camera,
microphone, screen, and location requests (`webPermissions`) and `Use signed-in sites from Chrome`
(`importBrowserCookies`) with an `Import now` button that runs `security.importCookies()` and
reports `Imported N cookies from <browser>` or `No supported browser found` inline; **Agents** —
a plain statement that agents run unrestricted, with no control. The panel
(`src/renderer/settings/security-panel.tsx`) drives a pure controller
(`security-settings.ts`) that loads on tab open, applies each change optimistically, and rolls the
touched keys back with the vault's reason in the footer when the main process refuses the write.
The switches are Radix switches (`role="switch"`, `aria-checked`, labelled by `for`), the
segmented control is a Radix radio group with arrow-key movement, and every control carries a
`security.*` id from `src/shared/ui-controls.ts`.

## Known boundaries from this source review

Parallel research now has an initial model-facing implementation: `search.run` starts several
queries and begins static source collection as each provider responds; `search.read` retrieves
incremental results and retained excerpts. Both search tools default to live presentation, opening
a background browser tab assigned to the calling chat with an actual source as soon as an eligible URL arrives, while other providers and
reads continue. Discovery stays in the search APIs; search-engine results pages never serve as
the research presentation, and the model-facing `navigate` refuses to open one. Subsequent searches in the same pane/thread/turn reuse that tab.
Models receive its id for inspecting source pages while research continues. Explicit background
mode opts out. Source fetching is unauthenticated; the source tab uses the
normal browser session. A source whose static body is a JavaScript shell is rendered once in a
hidden page worker (`src/main/browser-workers/`, at most three, on the public research session,
never shown or listed in the tab strip) and reported as `rendered_text`. Runs are tied to the
calling pane/thread/turn and stop with that turn or pane, which also aborts rendered reads.
Source coverage is adjustable per run: `max_text_chars` defaults to 120,000 (including Exa,
previously limited to 10,000), and `max_source_bytes` controls direct downloads. Zero removes
the corresponding app cap. `search.run.expand` refetches one retained source without rediscovery,
including after completion, with uncapped text by default. Failed or shorter expansions preserve
the earlier evidence. Direct PDF reads now extract text locally with PDF.js in cancellable workers,
returning `pdf_text`, page markers, and page coverage. PDFs require a complete download within the
byte budget; larger files can use expansion. Pages without text are flagged; documents without
native text retain their bytes for inspection. Expansion atomically publishes matching bytes/text
and reports a separate original-PDF hash. Exa expansion remains an alternative provider extraction path.
For visual PDF checks, models select the tab and use `embedded_browser.page read_page` with
`pdf_page`, or capture the viewer when layout matters. There is no dedicated research activity
panel, and workers cannot be handed to the user yet. See
[Tools](tools.md#parallel-research-runs) for exact limits and the
[design proposal](parallel-web-research-2026-09-04.md) for the remaining work.

- Provider threads the store has never seen appear in history search only after the background
  reconciliation adopts them, so a chat created in a provider's own CLI can lag one refresh.
- Background tasks (such as subagents, background terminal commands, and long-running tools)
  are tracked across providers; outer pane idle parking, project switching, and pane trimming
  respect active background work, and explicit session retirement marks unfinished tasks stopped.
- Raw `browser_cdp.protocol` calls bypass the semantic wrapper's input foregrounding and the
  capture namespace's image budget/storage. Target auto-attachment (now recursive, with leased
  network capture and recording across frames and workers) does not make the semantic wrapper
  traverse every out-of-process frame. These are described in the CDP guide.

These are source-level findings, not reproduced live failures or fixes delivered by this
documentation update. Dated visual verification gaps remain in [composer QA](../design-qa.md).
