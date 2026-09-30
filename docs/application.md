# Application guide

Chat renders Markdown, but does not interpret the Visualize skill's inline content-reference
markers or provide its `Tweak`/`window.openai` host runtime. HTML comparisons can be served locally
and viewed in the embedded browser; local HTML and SVG links open as their rendered page, with a
Page | Code toggle (see [Browser surface](#browser-surface)).

Native image generation from Codex (`imageGeneration`), Cursor (`GenerateImage`), Antigravity
(`generate_image`), and Claude tools with the same names render inline in the transcript as
`generated_image` screenshots when the provider returns image bytes, a saved path, a `file://`
link, or a brain artifact `.md` that embeds the image, both during live turns and when replaying a
saved thread. Claude Code sessions also load user skills from `~/.claude` so the `Skill` tool can
run workflows such as `canvas-design`. Click a generated image to open the full-size
browser-pane image viewer when a path is available. Pending generation remains an activity row;
failures display an error. The revised generation prompt is not used as a caption. These images
are display data, not instructions.

Source review: 2026-09-30. This describes implemented behavior, not a new live UI or provider
verification. Protocol measurements retain their dates in the provider guides. Provider context
delivery lives in [Model context](model-context.md); registry contracts live in
[Tools](tools.md).

Renderer UI changes are verified in Electron (`npm run build &&
npm run preview -- --skipBuild`, or `npm run dev` for hot reload). There is no separate browser-only renderer
entry or fixture bridge. A running checkout launch (unpackaged, not the dev server) polls
`out/renderer/index.html`; about 1.5 s after a rebuild settles it reloads every app surface
showing the built renderer (windows, detached windows, the quick chat layer), whoever ran the
build. It skips the reload and logs `[renderer-build] … restart the app` once when `out/main`
differs from the bundle the process launched with, because main-process changes still need a
restart (`src/main/renderer-build-reload.ts`). Only `out/main` is compared, so a preload-only
rebuild still reloads the renderer against the old preload; preload changes require a restart for
verification. Launching another preview can hand off to the existing single-instance app; it
does not prove that process loaded the new build. Verify the actual target surface after reload
or restart, and report pending restart separately from build success.

For model visual verification, first use `closedai_app.state` and successful tool calls to orient
to the actual target surface. Rebuild before checking preview UI, then confirm the running app
loaded the update; do not assume the process has the current reload watcher or that it succeeded.
If automatic reload is unavailable or loading the update cannot be confirmed, hard-refresh if
available. The application's `reload-renderer` menu key is not model-runnable through
`closedai_app.menu`; when no usable refresh path is available or the update still cannot be
confirmed, stop captures and report
"Build passed; visual verification pending a manual app restart." Report build failures separately.
Existing UI tools remain usable; a pending restart limits verification of the new behavior.

After the update loads, reveal the changed area and capture once. A further capture needs a
relevant edit or state change, a failed capture, or a specific unresolved visual detail; use a
retained crop when the first image lacks detail. Never poll for rebuild/reload completion with
screenshots. Captures inserted into the chat can change the next window image even when the
feature is unchanged, so pixel deduplication does not replace this stop rule.

### Renderer-only fallback

If `npm run build` stops at unrelated TypeScript errors, a renderer-only change can still be
built and checked in the running Electron app. First confirm that the errors are outside the
change and that the UI does not depend on new main-process, preload, or IPC behavior. From the
repository root, build only the renderer using the existing Electron Vite configuration:

```sh
node scripts/work-lock.mjs --cwd "$PWD" -- node --input-type=module <<'JS'
import { resolveConfig } from 'electron-vite'
import { build } from 'vite'

process.env.NODE_ENV_ELECTRON_VITE = 'production'
const { config } = await resolveConfig({}, 'build', 'production')
if (!config?.renderer) throw new Error('Renderer configuration missing')
await build(config.renderer)
JS
```

This replaces `out/renderer` while leaving `out/main` and `out/preload` untouched. It uses the
real renderer and preload bridge, with no alternate browser entry. The running checkout app
reloads the renderer as described above, provided its main bundle still matches. If no app is
running, `npm run preview -- --skipBuild` can launch existing main/preload artifacts; they must
already support the UI being checked. Do not restart an active app just to apply a renderer-only
change when automatic reload works.

Wait for the reload, then inspect the actual Electron surface and exercise the changed control.
A successful bundle alone does not verify that the app loaded it. This fallback does not run
TypeScript or hygiene checks: reuse successful hygiene results from the failed build's prebuild
step, or run hygiene when required for the change. Run the relevant co-located test. Report the
renderer verification separately from the blocked full build, including the unrelated errors;
this fallback does not establish that the full build passes. Changes requiring new main/preload
behavior still need those layers built and the app restarted.

Development and build commands run hygiene automatically. Dependency-layer violations block;
file sizes produce a compact, non-blocking advisory (`npm run hygiene -- --details` lists files).
Build also typechecks, so `npm run check` relies on the build for both checks rather than repeating
them. Generated maintenance-index sizes are advisory too; `map:check` still blocks stale data.
The injected session guide retains its separate context-size budget. Verification should reuse
valid results for the same code state and match the change scope.

## Find a workflow

| If you want to… | Start here |
|---|---|
| Find, reopen, or organize a chat across projects | [Workspace layout](#workspace-layout) |
| Arrange chats and the browser, or use multiple windows | [Windows on the canvas](#windows-on-the-canvas) and [Windows](#windows) |
| Switch workspaces or return to a saved arrangement | [Workspace overview](#workspace-overview-spaces) |
| Change a chat's folder or continue work in another project | [Projects, chats, panes, and conversations](#projects-chats-panes-and-conversations) |
| Open the browser quick chat or understand its controls | [Browser quick chat](#browser-quick-chat) |
| Write notes or chat with a model about a note | [Notepad](#notepad) |
| Understand what context models receive | [Model context](model-context.md) |
| Find a tool's arguments, limits, or trust boundary | [Tools](tools.md) |

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
pane's empty state (`chat-connection.tsx`) reads `window.closedai.chat.providerAvailability()`
(`ProviderAvailability[]` from `src/shared/provider-availability.ts`: provider, installed, resolved
path, hint) before any chat starts a provider; resolution follows each lane's spawn order (env
override, the installer's `~/.local/bin`, then PATH; Claude is the bundled SDK and always present).
The provider setup modal reads `window.closedai.chat.providerOnboarding()`
(`ProviderOnboardingStatus[]`, `src/shared/provider-onboarding.ts`), which adds each installed
lane's connection state and account email (`src/main/chat-hub-provider-onboarding.ts`).

First-run onboarding (renderer). Before the workspace is used on a fresh install, the shell shows
a full-screen **session gate** (Ubuntu-style local profiles: pick a user, enter a password, create
account with username/password confirmation, keep signed in, delete account). The gate paints a
solid background, so nothing of the workspace behind it shows through, and **Keep me signed in**
starts unchecked for every sign-in and new account. The account list
(`OnboardingSettings`, `src/shared/onboarding.ts`) is kept by main in `profiles.json`, outside
every profile's data, and reaches the renderer through `window.closedai.profiles`; a list an
earlier build kept in `localStorage` under `closedai.onboarding.v1` moves there once. Each **local
profile** owns its own `keepSignedIn`, `connectedProviders`, and `providerSetupComplete` flags so
a new account is not treated as finished with provider setup just because another profile on the
same machine already connected. Existing installs with chat history skip the flow automatically
and receive an implicit **Local profile** so the title-bar account menu and sign-out stay
available. After the gate, the normal title bar, workspace, and dock stay visible while a
**provider setup** modal lists all four providers as connected or not, probes installed CLIs for
existing sign-in, and offers a **Sign in** action (Codex opens ChatGPT in the browser; Cursor runs
`cursor-agent login`; Claude and Antigravity warm their lanes after CLI login elsewhere). Per-pane
empty states still show connection guidance when a lane later drifts out of `ready`. The modal
cannot be dismissed with Escape or an outside click; it re-probes every 8 s and on **Check again**.
**Continue** needs at least one connected provider; **Skip for now** also marks setup complete for
the profile. **Disconnect** clears only the profile's `connectedProviders` entry and does not sign
the CLI out, so a lane that is still `ready` keeps showing as connected. A Codex pane reaching
`ready` marks Codex connected without the modal. **Connect providers…** clears
`providerSetupComplete` and reopens the modal.

Passwords need at least 4 characters and a matching confirmation. A profile without a password
(the implicit **Local profile** of an install that predates the gate) cannot be signed in to until
one is set: its password step asks for a new password and signs in once it is saved. Hashes are
PBKDF2-SHA256, 210,000 iterations, 16-byte salt, compared in constant time
(`src/shared/local-profile-password.ts`); this is a machine-local deterrent, not cloud
authentication.

The title bar's left edge holds the account menu (`titlebar.session-account`, labelled **File**,
`session-account-menu.tsx`): the profile name, "Signed in on this device", **Connect providers…**
(`titlebar.session-connect-providers`), and **Log out** (`titlebar.session-sign-out`). The
application File/View/Agent/Developer menus live in the dock's Start panel; the title bar shows
them only when startup stalled before a pane exists, or in a detached window. Logging out
(also available through the application **File → Sign out…** / Start → search) clears the local session (`sessionUnlocked`,
`activeUserId`) and returns to the gate without deleting saved profiles or per-profile
provider-setup progress.

In the main window, provider subscription usage sits centred in the gap between the File dropdown and
chat search (`src/renderer/provider-usage/`): one ghost-button chip per provider
(`titlebar.provider-usage`): the provider mark and remaining percent as text, separated by a clean
vertical divider on the bar without separate pill surfaces. Level ink colours the figure
only, never the mark. A provider with no numeric window shows its mark alone; its plan and usage
details remain available in the popup.
All four providers appear on startup, before any provider chat connects. They show the lowest reported remaining allowance, keeping known accounts separate and using the
newest reading across account probes and attached chats; they never sum quotas across conversations. The popup
names every provider window, including model-specific scopes, remaining allowance, reset time,
observation age, plan and provider notes. Session connection is shown separately from quota.
At <=20% remaining the quota is low, <=10% critical, and 0% exhausted; a reading older than five
minutes or past its reported reset is stale, never assumed replenished. Partial Claude events
retain each untouched window's observation time. Missing data says unavailable. Codex reads `account/rateLimits/read` only: zero, one, or two
rolling windows (primary/secondary) plus optional credit metadata; the title bar shows reported windows
and plan, not inferred buckets. Credit balances appear in the composer usage card, not the title-bar
chips. Cursor reports monthly included, Auto, and API percentages through the same read-only dashboard
RPCs as the CLI’s `/usage` command. The chip uses the lowest remaining scope; the popup names
each scope and the billing reset, with on-demand spending as a note rather than an allowance. Background chat summaries carry telemetry even
when their transcript is not subscribed. The title bar also reads each signed-in CLI account through
`chat:readProviderUsage`, independently of chat runtimes, on mount and every minute while the
document is foregrounded. Reads are shared across windows for one minute, including failures;
failed reads preserve the last dated observation. Codex and Claude use short-lived control-only
processes, Antigravity uses `/quota`, and Cursor uses the CLI’s signed-in credential store and
read-only usage RPCs (`about` lets the CLI refresh credentials). These reads send no model turns
and do not wake or extend the idle lifetime of parked chats. Provider push events can supply
newer readings between polls. The popup offers an explicit refresh
(`titlebar.provider-usage-refresh`). When the gap is too narrow, a single **Usage** trigger
(`titlebar.provider-usage-all`), carrying the lowest remaining reading in a `Badge`, opens the same
provider/account tabs (`titlebar.provider-usage-tab`).

Each local profile owns a whole workspace (`src/main/profiles/`). A profile's data directory is
Electron's `userData` for the process that opens it, chosen before the instance lock and before
any store or Chromium session exists, so chats, open panes, notes, layouts, wallpaper, browser
tabs, cookies, history, saved sites, agents, security settings and the credential vault never
cross accounts. The oldest account is the **home** account and keeps the root directory, which
is the data that existed before profiles had their own; every other account lives under
`profiles/<id>/` and starts empty. One process holds one profile for its whole life: signing in
to (or creating) an account whose data is not the open profile shows an "Opening your workspace"
cover and relaunches into it after the normal quit flush, and that relaunch continues the
session even without keep-signed-in. Any other launch whose signed-in account lacks
`keepSignedIn` opens at the gate. Settings from before per-account flags copy their top-level
`keepSignedIn` (default on), `connectedProviders`, and `providerSetupComplete` onto every account
when read. Signing in to the account that is already open does not
relaunch. A launch opens the signed-in account, else the last one, else the home account, so the
gate is painted over that profile. Provider CLIs are signed in per OS user, so the provider
modal detects the same CLI sign-ins for every account; their thread stores are shared too, which
is why only the home account adopts threads from provider catalogs and other accounts list the
chats they made.

Deleting an account (`onboarding.gate-delete-start` on the gate's password step, then
`onboarding.gate-delete-confirm`) asks for the account's password when it has one, removes the
account from the list, and moves its workspace data to the OS trash; data the trash refuses is
deleted outright. Data that is not open is renamed to `profiles/.deleted-<time>-<id>` at once
and trashed in the background. Data the running process has open is recorded in
`pendingRemovals`, the app relaunches, and the next launch sets it aside before any store
opens. The home account's files are moved out of the root one by one, leaving `profiles.json*`,
`profiles/`, and Chromium's `Singleton*` lock files; the root is never handed to another account
afterwards. Provider CLI sign-ins and the providers' own thread stores are not touched. Deletion
is offered only on the gate. Deleting the last account opens Create account. Every launch hands any
`profiles/.deleted-*` directory left by an earlier one to the trash when main registers its IPC.

Launch resilience. A bootstrap failure is shown in a native error box and ends the app; an
uncaught exception or unhandled rejection after the window exists is logged with a `[main]`
prefix and survived (`src/main/app-crash-guard.ts`). The app shell reloads once when its renderer
is lost for a non-clean reason and reports a second loss within a minute instead of looping
(`src/main/main-window-recovery.ts`). `before-quit` bounds its flush at 5 s and quits regardless
(`src/main/app-quit.ts`); the MCP HTTP bridges drop open connections before closing their listener. Checkout `dev`/`preview`
launches own a separate POSIX process group. The launcher forwards SIGINT/SIGTERM to that
group and cleans it up when electron-vite exits, allowing seven seconds before killing
survivors even if the group leader has already exited (`scripts/launch-process.mjs`).
Electron account-switch relaunches start a separate process group and survive this cleanup.
This containment requires the launcher to remain alive; SIGKILL of the launcher cannot run cleanup.

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
A Cursor pane saves its ACP session id only once the session has taken a turn: cursor-agent
forgets a `session/new` that was never prompted, so a warmed-but-unused session is not reopened
on relaunch. A saved session the agent no longer holds is replaced by a new one, and the visible
transcript goes with that turn as a handoff; any other load failure keeps the saved id.
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

Each composer's folder panel (`composer.folder`, opened from the footer folder trigger) changes
only that chat's working directory. It offers a directory picker (`composer.project-new`), recent
projects (`composer.project-recent`), and “Don’t work in a project” (`composer.project-clear`,
uses the home directory). The model setup trigger (`composer.setup`) and folder trigger sit beside
each other in the footer.
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
transcript items (their serialized JSON capped at 256 KiB in UTF-8), its thread name, and its last
context reading, written to `chat-transcripts/<chat id>.json` at each turn boundary and read back
before the pane is announced. The view is display-only and never reaches a model; the provider's
replay replaces it as soon as it lands. It remains valid for the active thread or the last retired
session of a chat awaiting its next send after rotation, so relaunching that chat does not show
an empty composer. Startup rebuilds visible history from retained rotation sessions, in order,
and earlier-message paging crosses their boundaries. This is display history only: retired
sessions are read, not resumed as model context. Explicitly starting or opening another chat
clears the rotation history association. The cache drops oldest
items until the tail fits, including the last item if it alone exceeds the cap; older cache files
receive the same trimming when loaded. The provider retains the full transcript. The live transcript
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
short descriptive title in the background after a completed turn, from the initial user prompt and
optional assistant response, using the active provider in a separate ephemeral request (never while
the live turn is still starting). The input contains bounded text from the user request
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
first. The selected and visible panes (including visible blank tabs), active turns, and operations
in flight are protected, so this is not a hard concurrency limit. An undelivered continuation digest
stays on the detached record until the chat's first send. Detaching keeps the record and
its provider thread; the chat reopens from history search under the same id. A blank new chat (no
thread, no messages, no continuation, no open or wake in flight) may be discarded when the user leaves
it, but a chat still visible in the layout is retained.

`newChat` creates the record, attaches and selects it, announces the workspace before any
settings write, then wakes it; “Continue in new chat” takes the same path. `openChat(chatId)`
selects an attached chat, or attaches a detached one and resumes from its thread ids without
minting a new id. Main retains existing attached chats unless a departed chat is blank and no
longer visible. The renderer decides which tile displays a selected chat, as described below.

Continuation creates a new chat tab in the source tile with a local transcript digest, delivered once on its
next message. **Fresh context** (`composer.continue`) sits in the composer capsule beside Agents
when the latest response can hand off (an icon, labelled once the context window is half full); it is disabled while that chat's turn is actively running (`activeTurnId` set).
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
handoff. `chatHandoffTargetChars` is a soft character target (default 24,000; 0 retains all
selected conversation and evidence references). Complete user requests, the latest assistant
answer and plan, applicable checkpoint, and changed-file paths are protected even when they
exceed that target. Older answers are retained whole, newest first; omitted answers name their
recall item ids. Remaining space carries command/tool/file-change status references for recall,
not raw output, screenshots, or reasoning. No per-message prose clipping is applied.
This is deterministic selection, not a model-authored summary or a guarantee of semantic
completeness; long protected content can still consume a large provider context. It freezes the source's last item id, and
`peer_chats.recall` can search the current transcript or read that direct source—even after the
source pane closes—without opening it in the UI. Source recall stops at the saved boundary. A
checkpoint newer than a branch point is not carried. Missing boundaries (including legacy
continuations) fail closed. Retrieval uses existing provider stores; no second transcript
archive is introduced. When `chatSeamlessRotation` is enabled (default on; set false to opt out), idle context pressure
on Codex, Claude, and Antigravity can rotate the provider session invisibly: the visible
transcript stays put, a thin seed is queued for the next send, and each rotation appends metadata
to the chat record for later recall-chain work. Triggers include the saved percentage and token
budgets (`chatCompactAtPercent`, `chatCompactAtTokens`), plus a task-aware default in app settings:
transcript item count since the latest rotation boundary (`chatRotateAtItems`, default 100; `0` disables it).
Tool calls and tool output are not triggers: providers record tool work differently, and a busy
turn at low context would lose its working evidence for nothing. Each rotation record saves its
`reason` (`percent`, `tokens`, `items`, `manual` for an explicit compact, or `toolCatalog` when a
Codex tool-catalog change needs a new thread). Token pressure defaults to off; the window
percentage remains 80. Explicit saved values (including opt-outs and older token thresholds)
survive loading and unrelated writes. Item pressure counts only items after the rotation boundary.
Queued rotations stay invisible in the transcript; Turn trace records `session.rotated` when one completes. Source recall
on the same pane after rotation reads the in-memory transcript through the frozen boundary so tool
output remains recoverable without reopening the dropped provider thread. With seamless rotation on,
Claude Code auto-compaction stays off but background precompute compaction remains on by default
(`chatClaudePrecomputeCompaction`; set false to disable). Disabling seamless rotation restores the
native compaction path. Cursor keeps its native session regardless of idle/item pressure and the
global rotation setting; its explicit Compact action remains available when seamless rotation is on.
Provider child processes (Codex, Claude Code, Cursor, Antigravity) prepend
`scripts/closedai-bin` to `PATH` when `chatWorkLockEnabled` is on (default): an `npm` shim only
(not `node`, so MCP and `#!/usr/bin/env node` stay on the real binary) wraps heavy build/verify
invocations with `scripts/work-lock.mjs` and `.closedai/work.lock`. Per-pane
spawns also set `CLOSEDAI_VERIFY_LEASE` so the verify janitor skips active Electron harness work.
Manual wrap remains available: `node scripts/work-lock.mjs --cwd <repo> -- <command…>`.
See [Model context](model-context.md) for trust and [Tools](tools.md) for limits.

Cross-project memory uses `peer_chats.list(scope=history)` and `recall(scope=history)` against
existing provider stores — no separate archive or mandatory checkpoint. See [Tools](tools.md) for
limits and [Model context](model-context.md) for prompt delivery.

## Workspace layout

The workspace has no sidebar. A centered title-bar input searches saved chats across projects.
Header search and the History view tab read the same live workspace rows (`chats` events from the
main process, every directory, attached or detached) and share one model in
`src/renderer/chat-history/history-search.ts`: one visibility rule (`listableChat`: a blank pane
is hidden unless it is running or continues another chat), one order and time (`activityAt`: last
turn end, else store update), and one matcher (fuzzy title subsequence, then preview substring,
title hits first). Both show the project folder. Neither paints the whole store: a workspace holds
hundreds of closed chats and rendering them all made both surfaces slow to open. The header groups
and windows Closed to the 20 newest (`REST_CLOSED_LIMIT`; live groups are complete) and keeps 40
ranked matches for a query, with captions and footer saying "n of total"; the History view flattens
and pages 50 rows at a time behind a "Show more" control (`chat.history-more`).
Clicking or focusing the input opens a dropdown. The palette has one state and closes only on
discrete events: Escape, opening a result, focus leaving the component, a press outside it, or the
window losing focus (a click on the native browser view). Nothing is inferred from pointer position,
so moving the pointer over or away from the palette never opens or closes it. Presses inside the
popup do not move focus, so the input keeps the keyboard.
The dropdown groups chats into Running, Paused, Recently completed (unread), Open (still attached),
and Closed (detached, 20 newest), newest last turn first, in a scrollable list whose captions carry the counts.
Rows are single lines in a command-palette surface wider than the input: a live-state glyph (or the
provider's mark when idle, or the notepad icon when the chat was started from a notepad window),
the title, the project folder as a dim description, and the last-activity time on the right; a
search result also carries an Open/Closed tag since no group implies it. The History view and Start's
recent chats use the same notepad icon on those rows. Empty groups are omitted and each chat appears once. The closed input shows no count
badges; at rest it shows the Ctrl+H shortcut on the right, with the magnifying glass and placeholder
aligned left. The icon and text retain that alignment when the input is focused or contains a query.
Unread completions use the persisted review queue and move into History when opened.
Typing shows one list of up to forty ranked, case-insensitive matches across all groups, with
matched title characters highlighted. The keyboard cursor is the highlighted chat's id, so a list
that reorders underneath it (a turn finishing, a refresh adopting threads) never changes which chat
Enter opens; arrow moves scroll the cursor into view, hovering does not. Arrow keys select, Enter or
click opens, and Escape dismisses; the footer lists those keys and the result count. Each result has
a trash button, shown for the selected or hovered row, that removes the chat from history in one
click without confirmation. The chat hides immediately. Running chats cannot
be deleted; pending actions disable the buttons and failures appear below the search. The dropdown
stays open after deletion. Archive in the History view uses the same immediate archive path.
Ctrl+H and File →
Search chats focus it. File → Manage chat history opens (or, when it is already in front, closes) a
History view tab in the selected chat's tile.
New chats use the tab + button or File → New chat (Ctrl+N).
Two full-height chats can
sit on either side of the browser. The browser starts on the right; drag a conversation tab
onto the browser's left or right half to dock it on that side.
During a drag, the native browser view is temporarily covered so the drop targets can receive
the gesture. The dock's **Browser** icon (`dock.app`, item `browser`) and View → Toggle browser pane hide/restore the browser in its saved position without
closing tabs; `preview_html` shows it through the ui host's `revealBrowser`. The tile header **+** adds and selects a fresh conversation tab in the same tile. Chat headers end with the window buttons described under Windows on the canvas.
Hiding a tile neither detaches its runtime nor stops its turn; the model command `close_chat`
still detaches and stops it.

### Windows on the canvas

Every tile, the browser included, is a window (`src/renderer/chat-layout/floating/`). A window is
**tiled** (a slot in the split tree, laid out by dividers), **floating** (lifted out of the split
tree into its own rect, stacked above every tiled window) or **minimized** (listed in the dock). All
three stay in the one saved tree: a pane carries `float: {x, y, width, height, z}` while it floats
and `docked: true` while it is minimized, so tabs, grouping, selection, pruning, presets and
per-space persistence treat every window alike, and a window keeps its place (slot or rect) through
a minimize. `layoutGeometry` lays out only the tiled layer (`tiledTree`); floating rects are clamped
to the canvas when drawn so a header always stays reachable. The canvas draws windows in tree order
and stacks them with `z-index`, so a window changing layer never moves its DOM node or resets a
transcript's scroll.

A window's header is its title bar. Pressing its grip (`layout.pane-drag`; the browser's is
`layout.browser-drag`) or the header's empty space (for the browser, empty space in its tab strip;
tabs, window buttons, and **+** do not start a move, `window-move-handle.ts`) and dragging moves
the window with the pointer;
the box is painted outside React while it moves and the tree changes once, on release. A tiled
window tears off at a floating size under the pointer. Moving one window never resizes another: a
window released free out of the tiled layer leaves every other tiled window floating exactly where
it was on screen (`tearOffWindow` in `window-arrange.ts`), each still holding its slot in the tree.
Where it is released decides the rest: within 14 px of the workspace's left or right side it
becomes a full-height column there while other windows are tiled; with nothing else tiled it floats
over that half of the workspace, and when a floating window already fills the other half flush to
its side, the two become a tiled pair sharing a divider at that window's width (`snapToSide`). At the
top edge it maximizes; over a window's tab strip its tabs join that window (never the browser's);
within the outer band of a tiled window (up to 56 px) it splits beside it; anywhere else it floats
where it was dropped. An outline shows the landing place. A join instead rings the target window
above the one in hand, which fades back, and lights its tab strip with a ghost tab naming the chat
(or "+ N more") where it will land (`JoinTabsPreview`, `joinTabsTarget`); a tab dragged onto another
window's strip shows the same. Escape puts the window back. A floating window resizes from any edge or corner
(`layout.window-resize`) and comes to the front when pressed. Tab drags keep their own behaviour:
onto a tab strip or a tiled window's edge as before, and onto a floating window's tab strip to join
its tabs. Released on free space, or on a floating window's body, a tab tears off into its own
floating window there (`tearOffTab` in `window-arrange.ts`; the outline follows the pointer). It keeps
the size of the floating window it left, or a share of a tiled one, and takes a slot beside that window
so Tile windows can place it; the tiled layout does not change. A tear-off is refused once the
workspace holds 32 chat windows. A window's only tab moves the whole
window, as its title bar would. A chat opened beside a floating window (a split) floats too, cascaded from it.

The header's window buttons are **Minimize** (`layout.window-minimize`), **Maximize**
(`layout.window-maximize`; double-clicking a tiled window's header does the same, and Escape
restores) and **Close window** (`layout.pane-hide`, which hides without stopping, as before). The last visible
chat cannot be minimized or closed. Minimizing the browser hides it; the dock's Browser icon brings
it back. The selected window keeps full-strength buttons; the others dim theirs until hovered.
Double-clicking a floating window's header puts that window alone back into its slot.

The dock's **Layout** section lives in the dock settings popover (`dock.settings`, sliders icon on
the right; `dock-layout-menu.tsx`, rows `dock.layout-item`) and is the one place to put windows back together:
**Chats left, browser right** gathers every window and tab, floating and minimized ones included,
into one chat window left of the browser (the `browser-side` preset); **Chat, browser, chat** puts a
chat either side of the browser (`browser-between`: the extra windows' tabs join the right-hand
chat, and a new chat fills the right side when there is only one); **Tile windows** puts every
floating window back into its slot, so the last tiled layout returns exactly as it was
(`tileWindows`; minimized windows stay minimized but return to their slot; disabled while nothing
floats, also View → Tile windows and Ctrl+Shift+L); **Workspace layout…** opens the layout dialog.
Tile windows and the arrangements also end a maximize.

**Keep on top** (`layout.keep-on-top`, a checkbox in a chat window header's context menu) marks the
whole window, every tab in it, with `onTop: true` in the saved tree. It stacks above every window
without it (`ON_TOP` in `window-tiles.ts`), a tiled one included, and moving other windows later
does not cover it. The browser cannot be kept on top.

The native page paints above every DOM window, so while a floating window above the browser
overlaps it the browser shows its still (`browserCovered` in `window-tiles.ts`), and it goes live
again when that window moves away, is minimized, or the browser is brought in front. A window kept
on top cannot be passed that way, so the browser gives way to it instead: it is drawn in the
largest part of its rect that window leaves showing (`uncoveredRect`), and the page stays live. Only
when no such part meets the browser's minimum size does it keep its rect and show its still. A covered page
that was resized is captured once more after it lays out (`createBrowserFreezeRefresh`), and the
bounds hook waits for a gliding tile at any depth above the page before measuring it.

Each tile header shows conversation and view tabs and a **+** button (`layout.new-chat`) that adds
and selects a fresh conversation tab in that tile. It uses that tile's active chat model and
retains the previous tabs and the other tiles and divider sizes. Trace, Agents, History, Tools,
and the browser are opened from the title bar, composer pills, or keyboard shortcuts—not from the
tile header.

### Views

A view is a tab with a kind, not a chat and not a dialog (`src/renderer/chat-layout/layout-views.ts`,
`workspace-view.tsx`). Trace, Agents, History and Tools, which were pane dialogs, open as view tabs:
same strip, same drag, close, split and move-to-tile as chat tabs, persisted in the saved layout
under a `closedai:view:<kind>:<id>` tab id that main never sees (`setVisiblePanes` receives chat ids
only; a tile whose active tab is a view has no visible chat and its chats stay retained). A view
tab shows a kind glyph where a chat tab shows status: never a spinner, never unread. Opening a kind
already present in the tile focuses it instead of duplicating. A view can be the only tab of a tile;
closing it empties the tile like an emptied chat tile, and hiding the tile works as for chats. The
tile context menu offers no rename, pin, pause or resume while a view is in front.

Each view body starts with a toolbar whose only control is the scope chip (`view.scope`):
**Following · chat** (dashed) means the view shows its own tile's chat (the selected chat when it
lives there, else the tile's first chat tab; a tile with no chat follows the workspace selection),
so switching the tile's chat switches the view. **Pinned · chat** (solid) fixes one chat. Dragging or
moving a following view to another tile pins it to the chat it was showing, so it never silently
retargets; the chip menu returns it to following (`view.scope-follow`) or pins another open chat
(`view.scope-pin`). Pins to chats that close are dropped. Focusing a view tile selects the chat it
follows; that chat stays behind the view rather than being pulled in front. Ctrl+W on a tile with a
view in front closes the view before the chat behind it. The Agent and Developer menus, Ctrl+Shift+T
and Ctrl+Shift+I open the view in the selected chat's tile. The Tools view's repair action puts the
draft in the followed chat's composer and brings that chat forward; the Agents view starts runs beside
the followed chat's tile; the History view opens a chosen chat in its own tile and stays open behind it. Tab creation waits for the renderer's workspace snapshot to
catch up with the new chat before reconciling tabs; menu focus restoration cannot interrupt it.
The tab's full surface, including its title, activity icon, and padding, drags that conversation
(tab split, stack, or join). A 36 × 38 pixel grip at the left of the tile header (matching the
browser tab strip) drags the whole pane with every tab in it; compact equal-width tabs leave no
empty header space, so the grip is the reliable whole-tile target. Opening a view keeps conversation tabs at their usual width. The overlaid close button keeps its own click action; its
hit area is a 24 × tab-height strip around the existing 11 px icon, without a larger hover chip.
Click a tab to return to its conversation; arrow keys and Home/End
also switch tabs, and Delete closes the focused tab. Only the active tab's close button is in the
tab order. Tab strips scroll horizontally when full: narrow tiles keep a 96 px floor per tab so the
strip overflows instead of collapsing labels, a wheel over the strip pans it, and selecting a tab
scrolls it into view. Mounted drafts and attachments survive
switching tabs; unsent text (and attachments small enough to store) is also kept per chat in
renderer localStorage (`closedai.composer.drafts.v1`, newest 50), so it survives a relaunch. Each tab's close button removes it from the layout without deleting its history
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
tab; sibling conversations stay in place. Drop a tab onto another chat header to join its tab strip, or onto free space to open it in its
own floating window.
The highlighted region previews the split or tab destination. These moves preserve mounted drafts,
attachments, and transcripts and persist with the project's layout.

The 36 × 34 pixel grip at the top left of the browser tab strip moves the whole shared browser. Drop it at a
chat's top or bottom edge to stack it above or below that chat, or at a side edge to dock beside
it. During a browser drag, the workspace's far left and right edges place the
browser in a full-height column beside all chats; only the targeted edge shows its hint. Moving the browser preserves its tabs and
the selected chat; its position uses the same saved layout and resizable dividers.
While a pane or the browser is dragged toward a split target, tiles and dividers live-resize to
the layout that would result on release (the target tile halves to make room); the other chats and a captured
browser page stay visible and track their new bounds. The dragged tile's destination shows as a
semi-transparent placeholder of its size and place. Holding the pointer inside the placeholder for about
a quarter second after it lands shrinks the dragged chat or browser into it: a centred miniature of its
current form, laid out at its pre-drag size so nothing reflows (a dragged browser keeps its native bounds and
pre-drag still). Moving to another target empties the placeholder again. On release the miniature (or the
empty placeholder) glides out to fill the spot; on cancel it grows back in its original tile. Tiles and dividers glide to each new preview, to the accepted layout on drop, and back on a
cancelled drag (about 190ms, transform-only, so transcripts lay out once per preview; off under reduced
motion). A preview that changes mid-glide bends from where each tile currently appears. The native
browser stays occluded until the release glide lands, and native bounds are measured only once a
transform glide on the host or an ancestor has landed, never at a transitional size. Layout drags temporarily occlude the native browser after the still is ready, so
the moving native surface cannot intercept drag events. After each bounds update the preview
refreshes from the resized page, so responsive content reflows before release. The page never
leaves the main window for this: it is parked with one corner pixel inside the window, where
Chromium keeps it mapped, laid out at the preview size and painting, so each capture waits for a
real frame at that size. Captures are serialized and obsolete sizes are discarded;
the previous frame stays at its natural scale
until the replacement arrives, without stretching. The still remains through commit,
then clears after native bounds are restored and the page has painted a frame there. Preview dimensions update once per animation frame without size tweening, so
transcripts do not repeatedly rewrap after a target change. On release the accepted split stays
mounted until the chat-open operation commits (or fails); native drag-end cannot briefly restore
the old layout. A hidden browser takes no space in the preview, so chats can occupy full-height
columns across the workspace; its saved dock position is retained. Splitting either the active or an inactive conversation tab out of a group
shows both the dragged conversation and the remaining group in their proposed shells before release.
Hit targets for chat and browser drags stay fixed on the pre-drag layout so the destination
does not flicker. Chat and browser split choices hold through a 32-pixel boundary buffer (scaled down
for small tiles); the tab strip has a 12-pixel entry/exit buffer. Deliberate movement switches
immediately, and release uses the same held target rules as the preview. The 32-pixel workspace edge targets start below the tab strip and show a
full-height column label only on the active edge. Escape cancels; dropping over the browser, a divider, or outside the
workspace leaves the layout unchanged.

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

Dividers reserve a 14 px grab area between panes, with a muted 2 × 24 px center grip.
Hover reveals a subtle 1 px center line and brightens the grip; keyboard focus and active
dragging emphasize both with the focus color without filling the gutter.
This area stays outside native browser bounds. They resize horizontal and vertical
splits independently; arrow keys resize a focused divider by 5% (Shift: 1%), and double-click
balances it within pane minimums. Escape during a drag restores its starting proportions;
pointer cancellation and lost capture restore the starting proportions, while window blur commits
the last position. The final geometry is painted before releasing the gesture. Nested splits support columns, rows,
and quadrants, up to 32 visible chats. A tile has a 300 × 280 px minimum; the chat area scrolls
when a small window cannot fit the chosen arrangement. Every layout uses the same one-line
composer (a 48 px capsule row with a 34 px send/pause control). Once a draft wraps, holds a line break, or carries an
attachment, the capsule expands: the draft spans its full width and the tools, setup chip and Send drop to a row beneath it
until the draft is sent or cleared. A composer 460 px wide or less keeps that two-row shape even while empty,
since one row would leave the draft a sliver. Drafts grow upward within a tile-relative height limit and then scroll, leaving room for
the transcript.
Tiles at most 680 px wide or 640 px tall also tighten transcript spacing; under 540 px the setup
chip folds the folder to its icon, and the model name truncates only when the chip would pass half the row. Single-tab headers use the
available width for the title; the focused tile has the accent tab indicator.
The composer is one glass capsule floating over the foot of the transcript (`.chat-composer-dock`
in `chat-pane.tsx`, which also carries the connection banner, credential approvals, the agent run
strip and pane notices). The transcript scrolls underneath it: the dock publishes its height as
`--composer-dock-height`, the scroller pads its end by it, and text fades as it slides under the
capsule's live blur. The one-row capsule holds attach (`composer.upload`), the agents icon (`composer.agents`)
and, when the latest reply can hand off, **Fresh context** (`composer.continue`) on the left; the
draft in the middle; then the setup chip, whose model half (`composer.setup`, with a chevron) and
folder half (`composer.folder`) each open their own panel; and Send on the right. Send and the
focus ring are the chat's one colour: the theme accent, or the wallpaper's most vivid hue while a
backdrop is on. Sent user messages are cards cut from the same capsule material. New chat and
Browser are not in the composer: the tile header **+** and the dock own them. **Fresh context**
continues the full thread in a new tab with a digest on the first send. There is no collapsed mode;
pending attachment chips sit above the line inside the card. The setup trigger opens a panel
(above the trigger, or below when there is no room) with a Context line (`composer.context`;
used/window tokens, the first plan window, a meter) that expands to the full usage card with Compact
conversation, then only the providers, one row each (`composer.model-provider`), the pane's own
naming the model in use. Choosing a provider (click, Enter, or an arrow key) opens its models in a
flyout beside the panel (`composer.model-item`, context-size badges; another provider's flyout says
**Starts a new thread**). The flyout takes the side of the panel that has room inside the chat pane,
overlapping the panel in a pane too narrow for either side, and grows the way the panel opened:
upward from the row above the trigger, downward below it. Effort (segmented `composer.effort-item`,
or a "Set by <provider>" line for models without levels) sits under the models of the provider that
owns the selection. Left arrow or Escape returns to the provider rows. The folder trigger opens a separate panel with the current folder,
recent chips, and choose/clear actions (`composer.project-new`, `composer.project-recent`,
`composer.project-clear`). Model and effort rows are disabled while a turn runs; folder changes
queue until the chat is idle when a turn is in flight. The trigger does not change while a turn
runs: no spinner or elapsed clock. Agents opens a menu of saved agents: **Start new run**
(`composer.agents-start`, a new tab beside **this** chat's tile and the run starts at once; only a
**live** run for that agent offers **Open** instead), **New agent…** (`composer.agents-new`) and
**Manage** (`composer.agents-manage`) for the workspace Agents tab. The icon badges how many runs are
live workspace-wide. Agent → Agents… or the composer's **Manage** still opens the **Agents** view tab (`view.agents`,
`src/renderer/agent-library/`), which shows no scope chip and stacks three screens under a one-line
header. The **Library** opens first: a grid of saved-agent cards (`agents.card`; live runs first,
then most recently used, then never-run by name), each with the name, the first two lines of its
instructions, and its run count and last run, or its live run's state and cycle, plus **Edit**
(`agents.edit`) and **Start** (`agents.card-start`, which stays on the Library). The header offers
**Runs** (`agents.runs`, its label carrying the run summary) and **New agent** (`agents.new`); an
emptied library shows an empty state with New agent. **Build** (its back control, `agents.back`,
returns to the Library and keeps an unsaved draft for the session) is the editor: a name (`agents.name`), a
max-cycles cap (`agents.max-cycles`, blank runs until paused), and the standing instructions
(`agents.prompt`). The library (`src/main/agent-library/`, `agent-library.json`) is user-owned
and never pruned; a first open seeds it with the built-in agents (`BUILT_IN_AGENTS` in
`src/shared/agent-library.ts`: the repair agent and the UI coverage agent), and an emptied library stays empty. Each
built-in has a stable key; the file's `offered` list records which keys the library has been given, so a built-in
shipped later is added to an existing library once and deleting it sticks (a file without `offered` counts as
offered the repair agent). **Save** (`agents.save`)
keeps a new entry or the loaded one's edits; **Delete** (`agents.delete`) removes the loaded
entry and returns to the Library. **Start** (`agents.start`, also returning to the Library) docks a new chat and starts an **agent run** on it
(`agentRuns.start`) using the launching pane's model and folder. The run records the library
entry it came from (`agentId`, `name`), the strip and `closedai_app.state` show the agent's
name, and main counts the run on the entry (`lastRunAt`, `runCount`) once its first cycle is
out. The main process
(`src/main/agent-runs/`) owns the loop: the instructions are cycle 1, and after every finished turn
it waits a short settle delay and sends the next `Cycle N` message, so the chat never stops
because the model signed off. A turn that produced no assistant or tool output counts as a
failure; failures retry with backoff and the fifth in a row pauses the run with the reason. A
provider thread change (rotation or handoff) re-sends the full instructions with the next cycle.
The run record lives on the chat (`ChatRecord.agentRun`), so a relaunch shows every run paused
with "App relaunched". A strip above the composer shows the state and cycle count with **Pause**
(`chat.agent-pause`, also ends the turn in flight), **Resume** (`chat.agent-resume`) and **Stop**
(`chat.agent-stop`, removes the run and leaves an ordinary chat). The composer's own pause button
and a tool's `stop_agent` pause the run too; a user message sent between cycles is folded into
the loop rather than raced.

The **Agents tab** opens from the composer's Agents menu (Manage), the tile + menu, or Agent → Agents…. There is at most one Agents tab in
the workspace: any of those entry points opens it in its existing tile or creates it in the
selected chat's tile, then focuses it (Trace, History and Tools still dedupe per tile only).
Its **Runs** screen (from the Library
header's Runs control, whose label carries the summary of running and attention-needed runs)
lists every agent run in a minimal table, with state, cycle, and current activity or pause
reason. Under each row a brief of two to four plain sentences reads from the run's tallies
(`AgentRun.stats`, kept by main from the chat's own events, so an unmounted chat reads the same):
progress (how long the live cycle has worked, or how many cycles finished and when; steps and
file edits; model time in total), the last completed reply as an excerpt, cost (the context
tokens every cycle re-sends and their share of the window, rotations that re-sent the
instructions, and the account's plan windows with their resets), and, only when there are any,
errors (failed commands and tool calls plus error notices, with the last one's text). Durations
tick every ten seconds while a run is live on that screen. Runs needing the user appear first. Each run row offers **Open chat** (`agents.open-chat`), **Review** for a
pending credential approval (`agents.review`), **Pause**/**Resume**/**Stop** (`agents.pause`,
`agents.resume`, `agents.stop`; Stop reads **Dismiss** for a finished run). Opening a chat
reveals it as a tab in the workspace. An empty Runs screen offers New agent. Starting a run
still adds its chat as a tab. Models drive runs in other panes
with `closedai_app.agent` (`start` with a standing prompt attaches the same loop to an
existing chat; `pause`, `resume`, `stop`), and a run ends itself with `finish`, which pauses it
with `Finished: <summary>`. `closedai_app.state` reports the run under
`chat.agentRun`.

The **UI coverage agent** (built-in, 80-cycle cap) exercises every model-runnable menu row and
every `data-ui` manifest control the way a model would and records what each cost. Its memory is
the coverage ledger, `npm run ui-coverage -- next|record|status|reopen`
(`scripts/ui-coverage/`): jobs are derived on every read from `MODEL_MENU_KEYS` and
`UI_CONTROLS`, so they cannot go stale, and only results (status, cheapest path, tool calls,
note, fix) are stored, in the checkout's gitignored `.closedai/ui-coverage.json`. A menu job's
budget is one `closedai_app.menu` call and a control job's is three calls; failures and
over-budget results form the backlog `status` prints. Controls whose description deletes, clears,
resets, or closes something are marked `caution`. When `next` reports COMPLETE the agent reports
the backlog and calls `finish`. A menu job run by any path other than `menu` counts as over
budget; `status` also lists stale results whose job no longer exists.

Right-clicking any tile header or tab opens a context menu led by **Close tab** (`layout.tab-close`, Ctrl/Cmd+W),
then **Hide pane** (`layout.pane-hide`) and, with another tile open,
**Move tab to next pane** / **Move tab to previous pane**
(`layout.tab-move`, item `next` or `previous`) move the active conversation into the neighbouring
tile's strip in reading order, the keyboard route for a tab drag; an emptied tile collapses as it
does after a drag. Close, hide, and move rows show subtitles when tasks continue. A separator
follows, then **Workspace layout…**
(`layout.presets`), **Rename…**, optional **Pin chat**, and
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
in renderer localStorage, including tab order, each tile's active tab (a History or other view left
in front of a chat stays in front), the window's focused chat (`focused`) and its maximized window
(`maximized`, which reopens maximized after a relaunch). A layout change is written after 250 ms and
again on `pagehide`, so a reload or quit inside that delay keeps it. Missing/archived chats
are removed from a restored layout; layouts saved before tabs remain compatible.

**View** offers five one-click starting arrangements (`layout.dock-preset`, items `browser-side`,
`browser-between`, `browser-centre`, `six`, `four`: Chats left, browser right; Chat, browser, chat;
Browser centre; 6 chats; 4 chats) and **Workspace layout…** (`layout.preset-menu-custom`) to open the full
dialog. The tile context menu's **Workspace layout…** row (`layout.presets`)
opens a dialog (`layout.presets-dialog`) with two starting arrangements drawn to scale for the current
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

Group docking (minimizing a tile into a regional rail) is **not exposed in the UI** for now.
Saved layouts still load with any legacy `docked` flags cleared so tiles stay visible. The layout
tree may still carry dock metadata for future work; hide (`layout.pane-hide`) remains the way to
remove a tile from the canvas without stopping its chat.

`src/renderer/chat-layout/` owns the shared tree, geometry, persistence, and tile controls. The browser
is a reserved layout leaf, excluded from chat subscriptions, tab lists, and the 32-chat limit.
Hiding it only removes it from displayed geometry; its position and divider ratios remain saved.
Older chat-only trees gain a browser leaf on their right when restored.
`chat.setVisiblePanes(cwd, paneIds, retainedTabIds?)` registers display subscriptions and protects visible chats
from attachment trimming and blank-chat cleanup. Retained tab ids also protect empty tabs from
blank-chat cleanup without waking or subscribing to inactive tabs. It ignores stale project updates. The shared
snapshot's `panes` map contains the bounded visible views; `selected` remains the focus view for
existing consumers. Hidden panes retain their main-process state but do not stream text over IPC.

### Windows

A chat or view tab can leave the main window: **Move to new window** (`layout.tab-detach`) in the
tab context menu opens a frameless window of the same app shell holding that tab, which can be
dragged to another monitor. It is offered while the window keeps another tab. A detached window
has its own tab strip, splits, title-bar search and menus, but no browser: its **Browser** controls
bring the main window forward with the browser shown. In a detached window **Move to main window**
(`layout.tab-return`) hands a tab back; returning the last one closes the window. Closing a detached
window returns its chats to the main window's focused tile; hiding or closing is never stopping a
chat. Closing the main window quits the app.

Dragging a chat or view window by its title bar (in the main window or a detached one) until the
pointer is over another app window, with no window in front of it there, docks it into that window;
an OS-level window move does not. Main routes the drag (`windows.routeCrossDock`,
`src/main/windows/cross-window-dock.ts`) from each window's reported canvas rect
(`windows.reportDockSurface`) and sends the hover to the target as a `windowsEvent` `dock` event,
which previews it (`CrossWindowDockPreview`). The target first applies the canvas rules above,
except the ones an incoming chat cannot take (maximize, the workspace's side columns, splitting
beside the browser); otherwise over a tab strip the tabs join, over a window's body the chats stack
above or below it by half, in a gap they split on the nearest chat window's facing side, and with
no chat window to dock beside they float at 42% x 55% of the canvas (`resolveCrossDockTarget`). On
release (`windows.completeCrossDock`, which requires the last hover) main moves the tab ids between
window records and `app-windows.json`, the target absorbs them (floating them at the pointer if the
aimed drop no longer applies, so they always land in a layout), and the source drops them, closing a
detached source left empty. Tab drags stay inside their window, and the browser never crosses.

A chat lives in one window. Opening a chat another window holds (header search, History, a
split) raises that window and selects the tab there instead of adding a second tab. A chat no
window holds yet (a new chat, one a tool opened) goes to the window in front, or to the main
window when no app window has focus; focus is main's record of the windows, not the renderer's
`document.hasFocus()`. Bringing a window to the front selects its own chat, so keyboard shortcuts,
menus and tools act on what that window shows.

`src/main/windows/` owns the window registry. Each window reports its tiles through the same
`setVisiblePanes` call, now recorded per window: main keeps the union visible
(`src/main/chat-peers/peer-window-visibility.ts`), routes each chat's transcript stream only to
the window showing it, sends browser state only to the main window, and ignores browser bounds
reported by any other window. Workspace-wide events (chat rows, runs, tools, trace, saved sites)
reach every window. Detached windows are saved in `app-windows.json` (id, project, chat tabs) and
their layout in renderer localStorage beside the project's main layout (`#window:<id>`). Electron
persists each window's bounds, monitor and maximized state under its window name and falls back to a
connected display when that monitor is gone; on Wayland the compositor chooses placement. At launch
only the reopened window holding the selected chat takes focus; the others show inactive, because a
window taking focus claims the selection, and each window resumes the chat its layout last had focused. A
detached window belongs to its project: selecting another project closes it without handing its
chats back, and it reopens when its project is selected again or at the next launch.
`closedai_app.state` lists detached windows and their chat ids under `window.detached`; UI
automation, controls and capture still act on the main window only.

### Workspace overview (spaces)

A **space** (shown to users as a *workspace*) is one layout of its own — split tree, tabs, divider
sizes and browser position — plus the project folder main selects while it is shown
(`src/renderer/spaces/`). Several spaces can share a folder. Spaces live in renderer localStorage
(`closedai.spaces.v2`: `id`, `cwd`, `projectPath`, `name`, and the one last shown), and each space's
layout is saved under its id (`closedai.chat-layout.v1:<id>`); spaces made before ids existed use
their folder as the id, so their layouts carry over. The overview lists only these spaces: a first
launch has one for the folder it opened in, and a model's `project_switch` into a folder no space
uses adds one. Folders main merely remembers (`workspace.recentProjects`) are not listed.

**View → Workspace overview** (`titlebar.menu-item` `overview`), Ctrl+Shift+O, or Ctrl+scroll down /
a pinch zooms out: the live workspace shrinks into its slot beside the others, each labelled with
its name and how many of its chats are running, at most two to a row. Clicking a slot (`spaces.slot`, item is the space
id), scrolling up over it, or Enter on it zooms in; Escape, Ctrl+Shift+O or double-clicking the
background returns to the one you came from. **Add workspace** (`spaces.add`) is a dashed
workspace-sized tile with a +: beside the last space when there is an odd number of spaces, centred
on its own row below them when the number is even; the grid is sized with it in place. It opens no folder picker; choosing it zooms toward it. The new space uses the folder you were working
in (named after it, numbered when a space already has that name), starts a fresh chat (which
inherits the focused chat's folder and model), and zooms into it; with no saved layout yet it opens
as that chat on the left and the browser on the right. Back and forward (Alt+←/→ outside text
fields, or the mouse's side buttons) walk the zoom history of this session: overview and space
stops, stepping through the overview between spaces.

Zooming is a camera over one drawing: the space you came from is its live DOM scaled into its slot
(chats keep streaming), and every other space shows a still of how it looked when you last zoomed
out of it. Zooming out captures that still of the stage (`windows.capture`: the window's own page,
so it is taken once the browser's still is on screen and before anything moves; a capture slower
than 250 ms is dropped) and keeps it in localStorage (`closedai.spaces.still:<id>`, JPEG at most
1600 px wide) so it survives a relaunch. A space with no still yet (never zoomed out of, or one a
model's `project_switch` left) is drawn from its saved layout with its tabs' titles, their last
message, and live running or paused marks from the workspace-wide chat rows. In a space nothing is
transformed, so layout, menus and the native browser behave exactly as without spaces.
Before zooming out the browser is occluded and shows its captured still; the page keeps its
full-size bounds while zoomed out (`data-native-bounds-hold` stops bounds reports) and goes live
again when you land back in a space. The live workspace is `inert` while zoomed out.

A shown layout adopts main's selected chat, so a switch prepares the destination with no live
workspace mounted: main selects the space's project when it differs (`chat.selectSpace`, the same
selection a model's `project_switch` performs), then one of the space's own chats is opened and
selected (a chat in front of one of its tiles), and only then is the space mounted, in the same
render that lands the camera. No chat changes folder, stops, or loses its runtime; the other
spaces' chats keep running and can be reopened from search. A folder that no longer exists is
refused with a message in the overview. Detached windows hold one project's tabs and keep that
project's layout, so the overview is in the main window only.

### Dock

The **dock** (`dock.bar`, `src/renderer/dock/`) runs along the bottom of the main window. It is
hidden until the pointer reaches the window's bottom edge, which is the workspace's own 10 px
padding, so no native browser view ever covers it. It slides up over the workspace and sinks
380 ms after the pointer moves more than 24 px above it. An open list and keyboard focus keep it up.
While it is up it counts as an overlay (`data-slot="app-dock"`, whose `data-state` stays `open`
until the slide down ends), so a browser it covers shows its still. The Dock settings
**Keep visible** switch (`dock.keep-visible`) keeps it up and gives it its own row: the workspace's
bottom padding grows past the dock's reach (including magnified tiles), so the page stays live. **Magnify icons** (`dock.magnify`)
turns off the tray's magnification. Both are saved in localStorage (`closedai.dock.v1`). The dock
reads the spaces it navigates through `SpacesStage`'s `dock` render prop, so it exists only where
the overview does: in the main window, once a chat is selected.

Left: back and forward (`dock.back`, `dock.forward`) step through the zoom history as Alt+←/→ and
are disabled at either end and while a zoom is moving; their tooltips name where you are
(workspace and selected chat, or "All workspaces"). Right: Layout and dock settings
(`dock.settings`). Centre: the **app tray**, Magic UI's `Dock` (`src/components/ui/dock.tsx`,
`@magicui/dock`), with **Start** centred in the tray and one rounded-square tile per ClosedAI surface
on either side (`dock.app`, item is the surface), 48 px and growing to 64 px under the pointer.
**Start** (`dock.start`) opens a panel above the tray with search
(`dock.start-search`), a **Pinned** grid of common commands (`dock.start-pin`, item is the menu
row key: New chat, Search chats, Manage chat history, Toggle browser, Agents, Tools &
capabilities, Settings; `START_PIN_KEYS`), **Recent chats** (the six newest) when any listable
history exists (`dock.start-chat`, item is the pane id), and **All apps**
(`dock.start-all-apps`) listing every File, View, Agent, and Developer row with the same disabled
rules as the menus. Rows with a screen (Search chats, Manage chat history, Agents, Tools &
capabilities, Settings) open it inside Start, whether chosen from Pinned, All apps, or command
search (`startScreenForRow` in `dock-start-model.ts`); the same rows from the title-bar menus,
Ctrl+H, and Ctrl+, keep their header palette, view tab, or dialog. A screen has a back header
(`dock.start-back`; Escape does the same) over the same component its view tab or dialog shows
(`dock-start-views.tsx`: `ChatHistory`, `AgentLibraryView`, `ToolsPanel`, and `SettingsSections`,
which the Settings dialog also wraps). The panel is one fixed size for the home and every screen,
1120 px wide and up to 900 px tall, bounded by the room above the dock. Search chats (`dock.start-chat-search`) is the title-bar
palette's list (`chat-search-results.tsx`, row ids `titlebar.chat-search-*`) in Start's body.
Anything that leaves Start closes it: opening a chat, a Tools repair draft (sent to the selected
chat), starting an agent (docked beside the selected chat), or the wallpaper picker. Start always
reopens on its home. The footer names the current workspace and **All workspaces**
(`dock.overview`, pressed while zoomed out) toggles the workspace overview. Menu definitions and
`runMenuItem` are shared in `application-menu-model.ts`. The main-window header keeps chat search;
detached windows and startup retain the header menus because no dock is available there. Each surface
tile holds its icon from the shared list in
`src/renderer/app-icons.tsx`, which the view tabs use too. The strip is 44 px tall and a step lighter than the workspace
(`--surface-raised`); the tray sits in a tab that rises out of its centre, drawn with the strip as
one shape and one outline (`dock-surface.tsx`). The dock's box reaches as high as a magnified tile, so a browser under any of it is covered. **Chats** opens a new floating chat window with its own tabs (history stays in header Search chats and File → Manage chat history). **Browser** shows or hides the
browser. **Notes** opens the notepad (its open window, else the latest note, else a new one). **Agent runs** opens the Agents view; its tooltip carries the runs summary. **Saved
sites** and **Downloads** open a list above the icon. In Saved sites, a row (`dock.saved-site`)
shows the browser and opens the site, and **All saved sites** (`dock.all-saved-sites`) opens the
view. In Downloads, a finished file's row (`dock.download`) shows it in its folder. A neutral dot
under a tile means something in it is running or showing. Each tooltip gives the surface's name
and what is in it now. Windows minimized in the shown workspace follow the app tiles after a
divider (`dock.window`, item is the window's front tab): each shows its kind's icon, its tooltip
names the front tab and how many tabs it holds, and a click restores it where it was, in front, and
selects it. `DesktopWorkspace` reports the list through `onMinimizedChange`.

Every feature icon is named once in `src/renderer/app-icons.tsx`: a `line` icon takes the text
colour, and a `picture` (a future full-colour SVG) keeps its own. The tray tiles and the view-tab
glyphs read from that list, so a new icon set replaces entries there. A tile is the same shape for
either kind, so a new icon never changes the tray's size or spacing.

## Chat surface

- Dark-theme chat and view tiles use a neutral charcoal (`#1d1d1d`) canvas, with raised
  composers (`#262626`) and a darker full-width tab header (`#191919`), including
  the tabs, pane grip, gaps, and header actions. Browser
  tab headers retain the darker shell chrome (`#141415`); recessed workspace
  gutters (`#161618`) separate the panels.
  Chat tabs sit inside the header with 6 px rounded corners and short separators
  between all neighboring tabs, including selected and hovered tabs. Each tile's active tab uses bold white text; inactive
  labels stay gray, including on hover. Selection has no tab outline or top marker.
  The selected chat keeps a stronger neutral frame; transcript contrast stays
  constant across panes. Composers have a subtle
  contact shadow. Browser active tabs flow into a lighter (`#29292c`) toolbar,
  with a hairline beneath it and around the address field.
- The window header has a soft charcoal (`#181819`) background in the dark theme.
  It is 44 px tall, with a 30 px search field. Detached windows and startup also show a 30 px Radix menubar:
  an 8 px rounded frame, theme-tinted fill, hairline border, and inset hover/open highlights.
  Menu labels are 12.5 px; search and compact dropdown rows use 13 px text. Menus retain
  Radix keyboard navigation, typeahead, hover switching while open, and Escape dismissal.
  Window buttons sit at the right edge.
  The shell reserves the header's
  natural height so the workspace begins directly below its divider.
- Header search reads chat records across directories, attached or detached, including child chats.
  It matches titles, then previews; project names provide context. Opening a result calls `openChat` and selects
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
  prompt re-anchors. Agent-run cycle prompts preserve the reader's current position, so a running
  or paused agent chat can keep browsing earlier transcript history while new cycles arrive. A
  prompt only counts as newly sent while it is the newest transcript row, so
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
- The renderer initially receives the latest turn. All loaded transcript rows remain visible
  and scrollable; sending a message, switching tabs, and scrolling to the bottom do not fold
  earlier turns. The labeled **Load earlier messages** button fetches another turn by stable
  item id and preserves the reading position. There is no three-turn reveal ceiling.
  Stale pages after a thread change are ignored. Provider sessions and the main-process
  transcript remain complete for continuation, branching, and peer reads; this is display
  paging, not model compaction. Restoring overlapping provider history reconciles replayed
  and optimistic prompt ids within the same turn, keeping prompts before their replies.
  Codex history replay emits one replacement instead of streaming old items again.
- The model menu is two steps: a provider panel, then one provider's models in a flyout beside it
  (see the composer section above). Both the panel and the flyout use the chat pane as their
  collision boundary, and the flyout's side and width are computed from the pane's free room
  (`modelFlyoutPlacement`), so the picker never reaches over the browser column and never
  triggers the freeze-and-still path that a DOM overlay across the divider requires.
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
- There is no project rail: the folder lives in the composer's setup panel. The four application menus (File, View, Agent, Developer) are listed in Start's All apps; the main window's title bar shows them only as a startup fallback.
  File owns New chat, Search chats, Manage chat history, Settings (Appearance, Models, Credentials,
  and Security tabs), Sign out…, Close tab, and Close window; View owns browser visibility, Notepad,
  Workspace overview, Tile windows, layout presets, chat zoom, and fullscreen; Agent owns the
  Agents view (Agents…, the saved-agent Library with its Build and Runs screens, one tab per
  workspace), what the model is given (Tools & capabilities, likewise a view tab) and a "Selected chat" section naming
  the pane its rows act on (Shrink provider context, Stop turn; rows that do not apply are disabled, not
  hidden). **Shrink provider context** rotates or compacts the provider thread while keeping the visible
  transcript; it is available for Codex, Claude, Cursor, and Antigravity when seamless rotation is on
  (and for Codex native compaction or Antigravity native compact when it is off). Developer owns Turn trace and Saved sites (view tabs), Reload renderer, and Toggle DevTools.
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
  affordance. Any provider chat can show a muted next-prompt suggestion. Claude Code supplies its
  native suggestion; Codex, Cursor, and Antigravity make a separate, read-only follow-up request
  through that provider using the selected model. The request receives only the latest assistant
  answer, stays out of the ClosedAI transcript, and is discarded if another turn starts first.
  Codex runs the request ephemerally; Cursor and Antigravity may record their short-lived request
  in their own provider history. Like the placeholder, the suggestion stays one line, cut off with
  an ellipsis, with the Tab hint pinned to the draft slot's right edge; accepting it puts the full
  text in the draft, which expands the capsule. Tab or Right Arrow accepts the suggestion into the
  draft, Escape dismisses it, and typing hides it until the draft is empty again. Suggestions are
  transient and clear when the next turn starts. Typed drafts naturally hide the placeholder;
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
  the setup panel's Context section (`composer.compact`) and Agent → Shrink provider context when the provider supports manual
  compaction. The composer preserves unsubmitted drafts (text and pending attachments) per
  conversation pane across tab switching, unmounting, and relaunch, clearing them only on
  submission. The saved copy (`closedai.composer.drafts.v1` in localStorage) keeps the 50 newest
  drafts and leaves out any attachment over 64,000 characters, such as a large pasted image.
  Appearance settings separate message and composer font sizes
  (defaults 14 and 15 px, range 13–22) from chat zoom. The workspace wallpaper is opt-in
  (default Off) and chosen in the wallpaper picker (`renderer/backdrop/wallpaper-dialog.tsx`), opened
  from Appearance → Wallpaper (which closes Settings so the workspace stays visible) or from the
  empty-canvas background menu's Change wallpaper…. The picker opens on a current-wallpaper card
  (preview under two mock glass tiles, name, source, and an Image / Desktop wallpaper / Off switch;
  Image returns to the last picked image), then Curated and Your uploads grids with a check badge on
  the selected tile. Choices apply live; Cancel restores the wallpaper the picker opened with, Done
  and Close keep it. Off keeps the flat chassis; Desktop wallpaper paints the OS wallpaper (GNOME
  `picture-uri`/`picture-uri-dark`, read by main via `window:desktopWallpaper` in
  `main/desktop-wallpaper.ts`); bundled presets (`preset:aurora`, `preset:dusk`, `preset:ocean`,
  `preset:ember` in `shared/backdrop-presets.ts`, assets under `renderer/backdrop/presets/`) load in
  the renderer and use the same prepare path. Uploads (`upload:<uuid>`) come from the Add image… tile
  or a JPEG, PNG, WebP or AVIF file dropped anywhere on the picker (48 MB cap); the renderer draws a
  thumbnail and main stores image, thumbnail and a newest-first manifest under
  `<userData>/wallpapers/` (`main/wallpapers/upload-store.ts`, `wallpapers:*` channels), building
  every path from a validated UUID. Deleting the selected upload falls back to the last image. The
  background menu itself still lists Off, Desktop wallpaper and the presets. Every non-off source sits
  dimmed by its measured brightness; it shows in the gaps between tiles. The title bar and the dock
  are full-width rails of one glass, each tinted from the wallpaper band behind it
  (`--backdrop-rail-top`/`--backdrop-rail-bottom`, `railTint`) so both land at the same darkness over a bright sky or a dark
  foreground, with a hairline facing the
  workspace. Each rail carries a tab round its centre group, drawn with the rail as one outline
  (`renderer/rail/`): the dock's rises over the tray, and the title bar's drops round chat search.
  The title bar's strip is 32 px, so its menus and window controls sit in the strip while the tab
  reaches the full 44 px row and the desktop shows beside it; search is a recessed field in the tab. A chat's transcript area
  and the Overview stage are glass too: a once-blurred copy of the same image (`renderer/backdrop/`)
  under a near-opaque dark tint, painted with fixed attachment so it lines up with the desktop
  without a live blur. The composer capsule is the one live blur, and Send takes the wallpaper's
  most vivid hue (`--backdrop-accent`). Chat headers and tabs, the browser tile, and view tiles
  (Tools, History, Agents) stay solid.
- Ctrl/Cmd+, opens settings, Ctrl/Cmd+H focuses chat search, Ctrl/Cmd+N creates a chat,
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
  Local file links in chat responses include absolute paths (`file://` or `/…`), workspace-relative
  paths such as `src/foo.ts` (resolved against the chat cwd), and bare path-shaped prose with a slash.
  Raster images open in browser-pane image tabs through a bounded 32 MB read; other files open in an
  inert browser-tab viewer with a bounded 5 MB read, syntax highlighting, rendered Markdown for
  `.md` files, and line-range emphasis when the link carries a line suffix. Clicking a path on an
  inline tool diff opens the same viewer in diff mode (red/green unified view). Binary files show a
  preview error; directories are revealed in the file manager.
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
page load. Tab state and history are persisted separately. `browser-tabs.json` keeps each http(s) tab's
back/forward stack with Chromium's page state, so a restored tab reopens on the entry it showed (the
index is tracked through dropped `about:blank` and trimmed entries) at its scroll offset, a single page
included; quit re-reads the strip first, since scrolling alone does not trigger a save. A tab not yet
loaded, or crashed, keeps the stack it was restored with. When the active tab is not restorable (blank,
file, image), its left neighbour is shown.

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

### Browser quick chat

The main window's browser has a quick chat floating over the page. The live page is a native view
that paints above everything the app shell draws, so the quick chat runs in a transparent native layer
of its own: `QuickChatOverlay` (`src/main/quick-chat-overlay/`) adds a `WebContentsView` with a
transparent background above the page views, loads the renderer with `?surface=quick-chat`
(`src/renderer/quick-chat-overlay/`), and fits the view to the box the layer reports
(`quickChat.setSize`), in the page's bottom-right corner. `BrowserService` emits `page` with every bounds
report and `pageViewAttached` whenever it adds a page view, so the layer follows the page and is
re-stacked above it. While the page is covered (menus, dialogs, drags) or the browser is away, the
layer is parked one pixel inside the window corner like a covered page; it is transparent there, stays
loaded, and keeps following its chat. The layer is not a window: `AppWindowRegistry.attachSurface`
routes it workspace-wide events and the transcript of the chat it shows, and it takes no window
commands.

Closed, the layer is a round button (`browser.quick-chat`). While its chat runs, the button carries
a progress ring and the name of the site the browser shows (`quickChat` view `site`, from the active
tab's address); a turn that ends while the chat is closed leaves "Done on espn.com" (or "Stopped on …", "Paused on …";
"this page" off the web) beside it until the chat is opened. Open, it is the chat's own `ChatPane` in a card with two shapes. Whole is the
chat under a header with shrink `quick-chat.compact` (once there is a transcript), a menu
`quick-chat.menu` holding **Clear chat** `quick-chat.new` (disabled while a task
runs), and hide `quick-chat.close`; these card controls are shared with notepad windows and carry the
surface (`browser` or `notepad`) as their `data-ui-key`. Compact is the composer under one status line, such as
"Working on espn.com · Opened espn.com" (`quick-chat-feed.ts`: the turn's latest step in plain words
from `feed-phrase.ts`), with expand `quick-chat.expand` and hide; once the turn ends the line
reads "Done on …" with a two-line preview of the reply. While the task runs, the whole card's header
carries a turning mark before the title and the step under way ("Thinking", "Opening espn.com") with
how long the task has run (`run-clock.ts`); the compact line carries the same clock, so a quiet stretch
still reads as working. Only shrink and expand change the shape;
hide and Escape hide the card, and reopening a chat keeps the shape last chosen for it (whole at
first). Sending a message, a turn starting, clicks on the page, typing, and focus changes leave it
alone. Ctrl+J (Cmd+J)
toggles it from the page, the layer, or the app window while the page is on screen: main catches it
in `before-input-event` on each (`BrowserServiceOptions.pageKeys` for tabs, `isQuickChatShortcut`)
and sends a `toggle` request, and opening focuses the layer so typing lands in the composer. While
a composer panel or the menu is open, the layer grows upward so it fits; inside the layer
(`data-composer-panels="viewport"`) composer panels use the viewport, not the chat pane, as their
collision boundary (`composerPanelBoundary`).

The main window's layout owns which chat it is and whether it is open, and reports both with
`quickChat.setState`; the layer's requests (`quickChat.request`: open, new, close, toggle) reach the layout as
a `quickChat` window command (`chat-layout/use-quick-chat-overlay.ts`). Only the main window may call
`quickChat.setState`; `view`, `setSize`, and `request` answer only the layer's own page, and requests
are checked against that list (`quick-chat-overlay/ipc.ts`). The layer denies navigation and new
windows and reloads if its renderer process dies. It is a real chat: `newSideChat` calls
`chat.newPeer(anchor, { select: false, modelId, quickChatSurface: 'browser' })`, which creates it in
the focused tile's folder without changing the selection and tags the record so History shows its
surface. It starts on the model the quick chat last used (`chat-layout/quick-chat-model.ts`,
`closedai.quickChat.modelId` in localStorage, updated whenever the quick chat's model changes), and on the focused tile's model
only before any quick chat has had one, and main skips its early wake so the blank chat is not discarded before the
layout reports it. The layout saves it per space (`SavedChatLayout.browserChat`/`browserChatOpen`),
adds it to the ids sent to `setVisiblePanes` so main keeps it attached and streaming while closed, and
never pulls it into a tile: main selecting it leaves the tree alone, and opening it from History,
search, or Start (`activateTab`) shows the browser with the card open. **Clear chat** creates a fresh one and closes the
previous one through `closePeer`, which leaves a used chat in history and discards a blank one. The
layer's controls live in its own page, so `closedai_app.ui` (which drives the main window's page) does
not reach them.

### Notepad

A notepad window (`src/renderer/notepad/`) is an ordinary tile whose tabs are notes
(`closedai:view:note:<noteId>`, view kind `note`), so it floats, snaps, minimizes, tears off, and
restores like any window. It opens from the dock's **Notes** icon (`dock.app` `note`), View →
**Notepad**, or Ctrl+Shift+N: the open notepad window comes forward, else the latest note opens in a
new floating window, else a new note does. **New** (`notepad.new`) and the **Notes** menu
(`notepad.notes`: up to 30 notes not open in the window, and **Delete this note**) sit in the status
line under the editor with the caret position (`notepad.caret`). Tab titles are the note's first
non-empty line, with Markdown heading, list, and quote markers removed and cut at 60 characters
(`derivedNoteTitle`), unless the note was created with a name (`notes.create` `title`); the editor
has no rename control yet.

Notes are buffers, not files: main's `NotesStore` (`src/main/notes/notes-store.ts`) keeps each
note's text as `<userData>/notes/<id>.txt` beside an `index.json`; the editor saves after 300 ms
of typing (`note-sync.ts`) and the store writes atomically after a further 250 ms debounce, flushed
on quit, so typing saves on its own and untitled notes survive a restart. A note holds up to
2,000,000 characters and the store up to 5,000 notes. The text files are the notes and the index
only their names and times: an unreadable index is set aside as `index.json.corrupt-<time>`, and
every note file it no longer lists is adopted back under its derived title. An empty note
whose tab closes (and is open in no other window) is removed. The editor (`notepad.editor`) is
CodeMirror 6 with line numbers, Ctrl+F search, undo, Markdown colouring, and list continuation on
Enter; each note keeps one editing session for the window's life (`note-sessions.ts`), so undo
and the caret survive tab switches. Saves name the revision the buffer was built on
(`notes.save(id, text, baseRevision)`); a model edit that landed first makes main refuse the save,
and its change event is rebased over the unsaved typing (`note-sync.ts`, CodeMirror change sets)
before the buffer saves again, so neither side's work is lost. Lines a model wrote are tinted and
marked in the gutter until the window's next task starts.

Each notepad window has one chat, kept on its tile (`ChatLayout` pane `notepadChat`) and created
unselected the first time its round button (`notepad.chat`) opens it, on the model notepad chats
last used (`closedai.notepadChat.modelId`). The layout reports it visible like the browser's quick
chat, and it floats over the notes with the same card (`QuickChatCard`, surface `notepad`). The
tab in front tells main which notes the chat is about (`notes.bind`: the window's note ids and the
active note). Every turn carries that note (see [model context](model-context.md)), and a turn
pins the note it started on: switching tabs while it runs leaves the task there, shrinks a whole
card to its status line, and shows "The task stays on <note>" with **Go to it**
(`notepad.chat-go-to-task`). Closed, the round button carries the note's name while the task runs
and "Done in <note>" or "Stopped in <note>" after. Otherwise the card changes shape only on its own
controls. Ctrl+J while typing in a note toggles that window's chat: when main catches it (browser
page on screen), the layout's `toggle` goes to the focused notepad before the browser's quick chat;
otherwise the note view catches it in the renderer. Esc hides the card only when pressed inside it.
Binding also tags the chat record `quickChatSurface: 'notepad'`; bindings live in main's memory
(`notepad-bindings.ts`) and are re-reported whenever the active note view mounts. **Clear chat**
unbinds and starts a new chat for the window; the old one goes to History, or away when blank. Moving a note to another window leaves the chat behind.

On Linux, startup disables accelerated video decode by default because affected driver stacks can
accept and advance H.264 playback while compositing blank frames. This leaves GPU compositing and
WebGL available; only media decoding falls back to software. A known-good machine can opt back in
with `CLOSEDAI_KEEP_HARDWARE_VIDEO_DECODE=1`, while
`CLOSEDAI_DISABLE_HARDWARE_VIDEO_DECODE=1` explicitly keeps the safe default.

The omnibox combines navigation/search input with inline completion and a history suggestion
list. History matches can be removed through `browser.removeHistory`; this deletes the stored
history entry, not cookies or site data. `browser-omnibox.ts` owns the renderer interaction and
`browser-history-store.ts` owns matching and persistence. Saved sites lead the suggestion list
(marked with a star, no remove button) ahead of history rows for the same query; the main-process
`browser:searchHistory` handler merges the two within the six-row budget.

Saved sites (`saved-sites-store.ts`, `saved-sites.json`) are pages the user keeps on purpose, a
different thing from history (every page visited, pruned by frequency, skipped for agent-driven
tabs). The star left of Downloads (`browser.saved-sites`) saves or unsaves the active web page; when
the page is already saved the star is gold. Developer → Saved sites opens a workspace view tab (like
Trace or Agents) with the full list even when the browser is hidden. The view (`saved-sites/saved-sites-panel.tsx`)
lists rows newest first with favicon, title, host, an optional note (click it, or "Add note", to edit),
a brief check log (`lastCheckedAt` and `lastSummary`, empty until a daily brief runs), open, and a remove
control revealed on hover. Opening a saved site from the view restores the browser pane if hidden. The tab context menu
offers Save site / Unsave site for any web tab. Only http(s) pages can be saved; a saved URL is
identified without scheme or leading `www.`, so re-saving refreshes title and favicon instead of
duplicating. Each record also carries `tags`, `lastCheckedAt`, and `lastSummary`, empty until a
future daily-brief agent reads the page and writes back.

Right-clicking a browser tab opens tab actions for opening a new tab to its right, reloading,
duplicating, renaming, saving or unsaving the page as a saved site, closing, closing other tabs,
and closing tabs to the right. The menu also
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
default of white. The renderer's overlay freeze waits for its still, then parks the still-compositing
native page above and left of the window with one corner pixel inside it instead of toggling its
visibility, so chats docked beside the browser are never covered by the parked page and the page
keeps laying out at the pane's size; `browser:setBounds` waits
for a painted frame before resolving the return. A view moved entirely outside the window is
unmapped by Chromium and stops relayouting, and a view reparented into a hidden window comes back
with a hidden drawing widget; the corner parking avoids both, along with Electron's
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
line highlighting; reopening a link updates its line target. Local HTML and SVG files are the
exception: a plain link opens them as a web tab at their `file:` URL, showing the page the markup
builds, and a line or diff link opens their source. Either view carries a **Page | Code** toggle
(`file.view`, in the web toolbar or the file tab's toolbar) that `localFiles:setView` answers by
swapping the tab in place (`browser-service-special-tabs.ts`): the same tab id and strip slot, so
a chat's claim survives, and the page reloads from disk each time it is shown. In both cases, opening one
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
browser is collapsed or covered, the view stays in the main window parked at its corner, still
mapped and capturable at the pane's size.

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
| Local profiles: account list, per-account data directory, relaunch into a profile | `src/main/profiles/`, `src/shared/local-profiles.ts`, `src/renderer/onboarding/profile-storage.ts` |
| Session gate, local sign-in and passwords, provider setup modal, account menu | `src/renderer/onboarding/`, `src/shared/onboarding.ts`, `src/shared/local-profile-password.ts`, `src/main/chat-hub-provider-onboarding.ts` |
| Provider install detection and missing-binary messages | `src/main/provider-availability.ts`, `src/main/provider-binary.ts`, `src/shared/provider-availability.ts` |
| Chat records and persistence, settings migration | `src/main/chat-store/`, `src/shared/chat-store.ts` |
| Store file reads that set a damaged file aside, durable atomic writes | `src/main/store-recovery.ts`, `src/main/atomic-write.ts` |
| Attach/detach lifecycle, summaries, per-chat settings, idle parking, catalog reconciliation | `src/main/chat-peers/` |
| Agent runs: the turn-by-turn loop behind agent chats, retry and pause policy, relaunch restore | `src/main/agent-runs/`, `src/shared/agent-runs.ts` |
| Agent library: the saved agents the Agents view lists, seeds, and counts runs for | `src/main/agent-library/`, `src/shared/agent-library.ts`, `src/renderer/agent-library/` |
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
| App windows: registry, event routing per window, detached-window persistence, cross-window docking | `src/main/windows/`, `src/shared/app-windows.ts`, `src/shared/cross-window-dock.ts`, `src/renderer/app-windows/`, `src/renderer/chat-layout/layout-windows.ts`, `src/renderer/chat-layout/floating/cross-window-*` |
| Dock: bottom-edge reveal, zoom navigation, app tray and its lists, Start (`dock-start-*`); the shared feature icon list | `src/renderer/dock/`, `src/renderer/app-icons.tsx`, `src/components/ui/dock.tsx` |
| Title-bar provider subscription usage chips and popover | `src/renderer/provider-usage/`; usage reads in `src/main/chat-context/provider-usage.ts` |
| Workspace wallpaper: picker, presets, uploads | `src/renderer/backdrop/`, `src/shared/backdrop-presets.ts`, `src/main/wallpapers/upload-store.ts`, `src/main/desktop-wallpaper.ts` |
| Chat/project/history orchestration | `src/renderer/chat-pane.tsx`, `src/renderer/project-menu.tsx`, `src/renderer/chat-history/` |
| Transcript steps, background work, response actions | `src/renderer/transcript-rows.ts`, `src/renderer/activity-steps.ts`, `src/renderer/background-tasks.tsx`, `src/renderer/message-actions.tsx` |
| Notes store, model edits, notepad chat bindings | `src/main/notes/`, `src/shared/notes.ts`, `src/main/tools/notes/`, `src/renderer/notepad/` |
| Browser quick chat layer | `src/main/quick-chat-overlay/`, `src/shared/quick-chat-overlay.ts`, `src/renderer/quick-chat-overlay/`, `src/renderer/chat-layout/use-quick-chat-overlay.ts` |
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
injection, or native-read interception runs around a turn. On gated sends the in-memory workspace
ledger re-hashes the files it recorded (see [Model context](model-context.md#turn-data)); it is not
persisted.
Browser tools, credentials, and chat controls remain available through the shared registry.

App-owned files live under Electron's `userData`: `~/.config/closedai/` on Linux by default for
the home account, and `profiles/<id>/` inside it for every other local profile. Each profile
directory holds its own copy of every store below; `profiles.json` exists once, in the root.

| Store | Contents |
|---|---|
| `profiles.json` (root only) | The local accounts: the renderer's onboarding settings as written (names, PBKDF2 password hashes, per-account provider progress, signed-in account), the home account, the last active account, a one-launch resume marker set by a profile switch, and deletions waiting for the next launch. Written synchronously and atomically at 0600; an unreadable file is set aside as `profiles.json.corrupt-<time>` |
| `provider-catalogs.json` | The last model catalog read per workspace and provider, so a relaunch starts only the active provider and the picker still offers every model; a provider refreshes its own entry when selected |
| `chat-transcripts/<chat id>.json` | The bounded tail of each chat as the app last showed it, so opening one paints before its provider replays; display-only, pruned against the store's live chat ids on launch |
| `chat-memory-index/` | Derived global LRU spine index (default 10 recently active chats) for `peer_chats.search` and fresh `peer_chats.spine` reads; conversation spine only, not authoritative over provider stores |
| `chat-pane-lexical-index/` | Derived per-pane search JSON and SQLite FTS. Events invalidate lazily; chat-scoped search refreshes the latest transcript. SQLite rebuilds and queries run in a worker, only for searched panes; startup does not rebuild FTS, and JSON persistence writes only changed panes. |
| `chats.json` | Every chat record: id, project directory, provider, model and effort, per-provider thread ids, title, preview, created/updated/last-turn times, `quickChatSurface` (`browser`/`notepad`), archived flag, pin timestamp, parent chat, continuation digest, checkpoint, and the agent run driving the chat (`agentRun`: prompt, status, cycle, limits, failure count, last thread, and `stats`: step, edit, error and rotation counts, summed turn time, last reply and error excerpts, latest context and plan readings). Debounced atomic writes; flushed on quit |
| `app-settings.json` | Cookie-import latch; active workspace/project; the open chat ids (`chatOpenIds`) and `chatSelectedPaneId`; saved per-project open ids and selection in `chatWorkspaces`; tool switches and context/batch settings. Legacy `chatPeers` and `chatWorkspaces[].peers` are imported into `chats.json` once, keeping each pane id as the chat id, and removed |
| `browser-tabs.json`, `browser-history.json` | Restored tabs and omnibox history |
| `app-windows.json` | Detached windows: id, project, chat tab ids; rewritten on detach, return, and cross-window dock |
| `wallpapers/` | Uploaded wallpapers (`<uuid>.<ext>`, `<uuid>.thumb.jpg`) and a newest-first manifest; 48 MB image cap, 2 MB thumbnail cap |
| `agent-library.json` | Agents the user built and kept: id, name, standing instructions, cycle cap, created/updated times, last run and run count. Seeded with the built-in repair agent only when the file is missing; never pruned, debounced atomic writes, flushed on quit |
| `notes/index.json`, `notes/<id>.txt` | Notepad notes: the index holds id, title, `named`, created/updated times, and revision; each note's text is its own file. Up to 5,000 notes of 2,000,000 characters each; empty untitled notes are removed when their last tab closes; debounced atomic writes, flushed on quit. An unreadable index is set aside as `index.json.corrupt-<time>` and the note files are adopted back |
| `saved-sites.json` | Sites the user saved on purpose: id, url, title, favicon, note, tags, saved/updated times, and the `lastCheckedAt`/`lastSummary` slots a daily brief will write; never pruned, debounced atomic writes, flushed on quit |
| `Partitions/browser`, `code-cache/` | Chromium session data and app-configured code cache |
| `browser-cache-state.json` | Last measured regenerable browser cache size and prune timestamp; when Cache + Service Worker + GPU caches exceed 768MB and the seven-day cooldown has elapsed, startup and periodic maintenance clear only regenerable stores (cookies, localStorage, and IndexedDB stay intact) |
| `tool-telemetry.json` | Aggregate run/error/timeout counters; no arguments or conversation text |
| `security-settings.json` | Settings ▸ Security: `credentialsRequireApproval`, `secretsRequireKeychain`, `webPermissions`, `importBrowserCookies`. A missing file is every default, which is the behavior before the tab existed; an unreadable one is set aside as `security-settings.json.corrupt-<time>` and never overwritten |
| `credential-vault.json` | Saved credentials: service id, entry label, timestamps, per-entry `agentAccess` (absent on older records, read as on), and one record per field. Secret fields are `safeStorage` ciphertext (base64); hosts, usernames and URLs stay readable so the list renders without decrypting. Written atomically at 0600. Only a missing file is an empty vault; a file that cannot be read is set aside as `credential-vault.json.corrupt-<time>` before the vault continues empty, so the next save never overwrites it. Entries the earlier localStorage vault held are moved here on first open and the localStorage copy is cleared only after every entry lands |
| `antigravity/profile/`, `antigravity/attachments/`, `antigravity/transcripts/` | Generated agent plugin, materialized image attachments, and app-recorded transcripts; the CLI retains its own conversation store |
| Renderer localStorage | Appearance and wallpaper choice (`closedai.appearance.v1`), dock preferences (`closedai.dock.v1`), overview stills (`closedai.spaces.still:*`), model-picker usage, quick chat and notepad chat models (`closedai.quickChat.modelId`, `closedai.notepadChat.modelId`), completion review queue (including review time; legacy storage key retained), message timestamps, per-space and per-window layouts (`closedai.chat-layout.v1:*`), spaces, and unsent composer drafts |
| In-memory trace | At most 4,000 entries and 24,000,000 detail characters, 48,000 characters per detail before its truncation marker; cleared on restart |

Only a missing store file means a fresh start. When `chats.json`, `app-settings.json`, or
`browser-tabs.json` cannot be read or parsed, the file is renamed beside itself to
`<name>.corrupt-<timestamp>`, one warning names that copy, and the store starts from defaults, so
the next debounced write never replaces the only copy of the user's data. Quit waits (at most 5 s)
for every store to flush; a second quit request during that wait, such as another signal or the last
window closing, waits for the same flush instead of exiting mid-write. Once the chat service stops at
quit, nothing rewrites the open chat ids, so the next launch reopens the chats that were open. Blank
chats stay attached past the 8-chat cap, since a detached blank chat is not listed and its tab would
vanish from the strip. Store writes reach the
disk (`fsync`) before the temp file is renamed into place. A `credential_vault.read` result never
enters `chat-transcripts/` or the Antigravity transcript copies: the model receives the values,
and the transcript's tool row keeps `[credential values withheld from the record]`.

Legacy top-level `chatThreadId`, `chatClaudeSessionId`, `chatAntigravityConversationId`, model,
and effort fields coexist with chat records. New code should use `PeerSettings` (a projection of
the chat record) for a chat's settings, not assume those top-level fields describe every chat.
Provider session history lives in each provider's own store; closing a pane, archiving a chat, and
archiving a provider thread are distinct operations.

Codex-specific settings are `chatCompactAtPercent` (default 80), `chatCompactAtTokens` (default
0, opt-in between-turn token threshold; 0 disables), and `chatMidTurnCompactTokens` (default zero,
leaves the CLI's limit). Settings files without `chatCompactionPolicyVersion` 1 migrate the
retired defaults once on load (60% becomes 80, a 28000-token budget becomes 0). The percentage and between-turn token triggers are independent; setting
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
It also records `response.turn_complete` when the turn ends, including elapsed time to first text,
tool and command counts, and summed command wall time for that turn. The first-text clock starts when
the pane manager receives Send, before waking the pane. It ends when main receives non-empty assistant
text, including commentary, not when the renderer paints it. Provider queueing, reasoning, tools,
and internal compaction are not individually separated after dispatch.
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
secret fields with Electron `safeStorage` before writing. Vault mutations are serialized and become
visible to reads only after persistence succeeds; a failed save leaves the previous state intact.
Structurally invalid vault JSON follows the same recovery-copy path as unparseable JSON, preserving
the original file before a replacement vault is saved.

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
tool waits for `security.resolveCredentialApproval`, rechecks that the entry still exists and has
agent access after approval, refuses on deny, and an unanswered card is denied
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
The main-process store serializes patches and activates and announces each change only after its
write succeeds, so a rejected save leaves the active settings unchanged.
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
