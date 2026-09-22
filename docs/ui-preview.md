# Browser UI development

Run `npm run dev:web` from this checkout. The command starts a local Vite server or reuses the
healthy server for the same real checkout path, then exits with JSON containing its URL, PID,
scenario links, and log path. It does not launch Electron. Concurrent launch requests share
one server; another checkout gets its own identity. Vite tries port 5173 and then available
ports, so always use the returned URL rather than assuming a port.

```sh
npm run dev:web                     # Start or reuse; conversation preview URL
npm run dev:web -- start streaming  # Same server; streaming preview URL
npm run dev:web -- status           # Inspect without starting
npm run dev:web -- stop             # Stop this checkout's verified preview server
```

The process stays alive across model turns. Keep it running throughout UI work so Vite can
apply hot updates; stop it when no longer needed, accounting for other chats using the same
checkout. Status and startup verify a per-process identity through a loopback health endpoint.
State, a short-lived launcher lock, and server output live in a checkout-specific directory
under the OS temporary directory. Failed startup reports the log tail. The launcher forces
development mode even when its parent Electron process has `NODE_ENV=production`.

## Model workflow

1. Run the start command once and use its returned URL with `embedded_browser.page navigate`.
2. Select your preview tab with `closedai_app.command browser_tab select` before waiting for
   animation-frame-driven UI updates. An unselected Chromium page can suspend those frames.
3. Wait for `html[data-preview-state="ready"]`, then inspect `embedded_browser.script console`
   for errors. Server health alone does not establish that the UI rendered. An uncaught runtime
   error or React render failure sets `data-preview-state="error"` and shows an error notice.
4. Edit the actual component or stylesheet. Keep the server and tab open; check the affected
   interaction and capture the result with `closedai_ui.capture`. Do not rebuild Electron for
   each frontend edit. Models can operate the existing controls through the browser tools.
5. Run the repository's targeted verification. Use real Electron for behavior the preview
   cannot establish. Release the browser tab assignment when finished.

## Repeatable states

The query parameter `scenario` chooses the fixture. The launcher output includes direct links to
all eight states (for example `/?scenario=split`); `npm run dev:web -- start settings` returns the
settings URL on the same server. There is no preview toolbar: the real app occupies the full
viewport, with no extra header height or preview overrides of the app shell's sizing. The browser
tab title identifies the preview and current scenario.
Navigating to a scenario resets sample conversations, layout, drafts, and appearance preferences.
The preview supplies document-private, in-memory storage to the real renderer in place of local
storage. Tabs cannot overwrite one another's fixtures or preferences. Component hot updates
preserve the current document's state; navigation/reload resets it.

| Scenario | Initial state |
| --- | --- |
| `conversation` | Two chat tabs, a populated transcript, sample tool activity and Markdown table |
| `empty` | Empty selected chat and composer |
| `streaming` | A finite timed sample answer with the real streaming UI and pause control |
| `settings` | Appearance settings open over a populated conversation |
| `split` | Two stacked chats beside the browser chrome and labeled native-surface placeholder |
| `unavailable` | Empty chat whose provider executable is missing: first-run guidance, provider availability list, and the disabled composer |
| `security` | Populated conversation beside the browser chrome with the opt-in security prompts pending: credential approval cards above the composer and web permission bars under the tab strip (both off by default in the real app) |
| `project` | Disposable Project-shell prototype. Intake fills a direction record (what, who, first session, boundaries, evidence) one question at a time and refuses vague answers; Start unlocks only when the record is complete. After Start, the project file tree (shared state led by the original request, then direction, research, decisions, scopes, quality, journal) sits on the left; the stage shows the intent map growing from the root coordinator, or a full-stage node or file detail with breadcrumbs. Every node, file, message, and journal line is timestamped. Files are editable in place (history files read-only); a record edit becomes a map amendment, and composer direction lands on the opened node or the node that owns the opened file. A header Catch up button (and an away banner after 30s idle) opens a short priority-descending report of what changed since the user last caught up |

Sending a message streams a local canned response. Pausing, creating/selecting/renaming/closing
sample chats, model effort selection, layout changes, and appearance settings exercise real
renderer code. Browser tab selection, closing, duplication, and renaming simulate chrome state.
These are fixtures, not actual provider or browser service operations.

## Boundaries and maintenance

The production HTML points to `src/renderer/main.tsx`. Only `web.vite.config.ts` in serve mode
substitutes `src/renderer/preview/entry.tsx`; Electron never imports the fake bridge or preview
styles. The preview entry refuses to overwrite an existing Electron bridge. Its implementation
is checked against the full `ClosedaiApi` contract, so bridge changes require an explicit fixture
decision. Extend the fixtures for a new UI state instead of building a separate HTML copy of the UI.

Native window actions, real filesystem access, credentials, provider calls, browser page content,
downloads, and IPC/security behavior need real Electron verification. Unsupported actions display
an on-demand, dismissible preview notice over the bottom of the viewport; it does not resize the
app. Dismiss it before visual comparison. Operations requiring native return data reject rather than inventing it. The
tools, trace, downloads, credentials, and research panels have empty sample read models, not live
data. No credentials or conversations are copied out of the running app.

React fast refresh needs its development inline preamble. The web-only HTML transform allows
that preamble; the Electron production CSP is unchanged. Renderer changes hot-update; changing
preview infrastructure resets the fixture. Launcher edits require `stop` followed by `start`.

Targeted checks:

```sh
npm run typecheck
node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs --test src/renderer/preview/chat.test.ts scripts/ui-preview.test.mjs src/shared/ui-controls.test.ts
npm run hygiene
```

The launcher test uses an isolated temporary checkout and real Vite, covering concurrent reuse,
status/stop, stale metadata, and argument errors. The bridge tests exercise snapshot isolation,
stream/pause cleanup, chat lifecycle, and native-operation boundaries. Browser visual checks are
still necessary; these tests do not prove the appearance of a changed component.
