# CDP tool foundation

ClosedAI uses Electron's in-process `webContents.debugger` transport. It does not open a
remote-debugging port. The primary model-facing browser interface is the eagerly advertised
`browser_cdp.protocol`. `browser_cdp.page` supplies semantic element refs and an input wrapper.
Source review: 2026-09-03; the behavior below follows the current implementation.

## Ownership model

- A ClosedAI tab id is the public identity. CDP target and session ids are transient children.
- One lazy CDP connection belongs to the current `WebContents` of a ClosedAI tab.
- Destroying that `WebContents` destroys the connection and its event history.
- A connection id distinguishes event cursor generations after a reconnect or replacement.
- Flat child-target sessions are routed by the optional CDP `session_id`.
- Target discovery and flattened auto-attach are initialized lazily. Session detach clears stored
  session ids; a later attachment retries discovery. Discovered targets need not all have sessions.
- Native popup windows are addressable by app-owned `popup-<webContents id>` roots even though
  they are absent from the regular tab strip.
- DOM node ids, runtime object ids, execution contexts, frames, requests, and target sessions
  must be treated as navigation-sensitive handles.

## Actions

### `capabilities`

Returns the selected ClosedAI tab, a connection id, `Browser.getVersion`, and
`Schema.getDomains`. This reports the protocol actually bundled with Electron rather than
assuming tip-of-tree support.

### `targets`

Returns `Target.getTargetInfo` for the selected root, `Target.getTargets`, and the connection's
live `inventory`. Each inventory entry includes type, title, URL, attachment status, `sessionId`,
opener id, subtype, and waiting-for-debugger status. `Target.setDiscoverTargets` and
`Target.setAutoAttach({ autoAttach: true, flatten: true, waitForDebuggerOnStart: false })` run
on attachment. Use an inventory `sessionId` as `session_id` in subsequent commands. When a
discovered target has no usable session, attach it explicitly; reacquire stale ids after navigation.

### `target`

Wraps `attach`, `detach`, `create`, `activate`, and `close`, then returns the operation result
and refreshed target inventory. Attach/activate/close require `target_id`, detach requires
`session_id`, and create requires `url`. Attach uses `flatten: true`. Use `command` for other
Target parameters, or `closedai_app.command browser_tab` to manage the app's regular tab strip.

### `command`

Sends any CDP `Domain.method` with its raw parameters. `tab_id` defaults to the active
ClosedAI tab. `session_id` routes to a flat child-target session.

`Input.*` and `Page.captureScreenshot` are allowed, and `protocol` is no longer deferred. Raw
commands do not invoke the semantic wrapper's foregrounding, readiness, or hit-testing. Input
needs a rendered target; do not infer that a hidden page received it merely because CDP returned.
Prefer whole-string `Input.insertText` to individual key events when entering text through CDP.

Raw screenshot output remains JSON text containing base64, subject to the 16,000-character JSON
result cap; it is not converted to an image or placed in `ScreenshotStore`, and larger payloads
can be truncated. Use `closedai_ui.capture` for a budgeted image with a retained display copy.

### `events`

Reads instrumentation events from a per-tab cursor. Domains only emit their full event sets
after the corresponding enable command. Each response returns `connectionId`, `oldestCursor`,
`nextCursor`, and `missedEvents`.

The buffer holds the newest 1,000 events. Oversized event parameters and model-facing command
results are explicitly truncated. These are resource bounds, not capability restrictions.

## Agent page wrapper

### `inspect_page`

Returns visible interactive elements from the selected tab. Each result includes a semantic
role and name, a snapshot-scoped ref, frame id, state, bounds, center, and an eight-number
quad. Coordinates are always labelled `main_viewport_css`: CSS pixels measured from the main
frame viewport's top-left corner. Child-frame coordinates are transformed through the iframe's
live content quad. Frames that cannot be inspected are reported instead of silently omitted.

Refs intentionally expire. An inspection installs an isolated-world element registry for its
snapshot; a later inspection replaces it, and navigation destroys its execution context.
Inspection alone can read a background tab without selecting it. All input verbs, including
both scroll forms, currently pass through `BrowserCdpAccess.realInput`: it foregrounds a regular
tab, waits for frames after switching, and returns `activatedTab: true` when selection changed.
An obscured/hidden browser page or a native popup root cannot use this semantic input path.

### `click`

Accepts a ref from the latest inspection. It verifies the same snapshot and connected element,
rejects disabled elements, scrolls the element and its iframe-owner chain into view, recomputes
the point, verifies the element is not covered in its own frame, hit-tests the main-viewport
coordinate, and dispatches the mouse move/press/release sequence through CDP.

### `click_at`

Accepts explicit `x` and `y` values in `main_viewport_css`. It rejects points outside the live
visual viewport, performs `DOM.getNodeForLocation`, and then dispatches the same real mouse
sequence. Element refs are preferred because raw coordinates have no semantic identity and go
stale after scroll, resize, animation, or layout changes.

### `type`

Accepts a ref, focuses it with the same real click pipeline, verifies it is an input, textarea,
or contenteditable element, selects the existing contents unless `clear` is false, and inserts
the whole string with one `Input.insertText`. The result echoes the field's value (truncated)
so the model can confirm without re-inspecting. One call replaces the per-keystroke
`Input.dispatchKeyEvent` sequences models otherwise fall back to.

### `press_key`

Dispatches one real `keyDown`/`keyUp` pair for a named key (Enter, Tab, Escape, Backspace,
Delete, arrows, Home/End, PageUp/PageDown) or a single character, with optional `alt`, `ctrl`,
`meta`, `shift` modifiers. Ctrl/meta chords suppress the text payload so shortcuts do not also
insert characters. Text entry belongs in `type`; this is for submits, dismissals, and chords.

### `scroll`

With a ref, scrolls the element to its frame's viewport center and reports the resulting scroll
offsets. Without one, dispatches a real `mouseWheel` at the main viewport's center using
`delta_x`/`delta_y` CSS pixels. Refs and coordinates from earlier inspections may be stale after
scrolling; inspect again before clicking.

This first wrapper inspects frames reachable from the selected page target. Out-of-process
frames that require their own flat target session are surfaced as uninspected frames. Automatic
target attachment makes raw session commands possible; it does not extend semantic wrapper
traversal to every OOPIF. Use the inventory and raw protocol for those frames.

## Deliberately deferred

Security classification, command allowlists, user approvals, and human/agent interaction
arbitration are not implemented by this transport. Registry resource locks and parallel-batch
scheduling cover a subset of browser operations; see [Tools](tools.md#application-facts-browser-targets-and-batching).
Those locks do not arbitrate human input or make cross-tab foreground input sequences atomic.

## Primary references

- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [CDP Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/)
- [CDP Runtime domain](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)
- [Electron Debugger](https://www.electronjs.org/docs/latest/api/debugger)
- [Electron WebContents](https://www.electronjs.org/docs/latest/api/web-contents)
