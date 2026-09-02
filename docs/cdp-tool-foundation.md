# CDP tool foundation

ClosedAI uses Electron's in-process `webContents.debugger` transport. It does not open a
remote-debugging port. The model-facing surface has a raw action tool,
`browser_cdp.protocol`, and an agent-oriented geometry/input wrapper, `browser_cdp.page`.

## Ownership model

- A ClosedAI tab id is the public identity. CDP target and session ids are transient children.
- One lazy CDP connection belongs to the current `WebContents` of a ClosedAI tab.
- Destroying that `WebContents` destroys the connection and its event history.
- A connection id distinguishes event cursor generations after a reconnect or replacement.
- Flat child-target sessions are routed by the optional CDP `session_id`.
- DOM node ids, runtime object ids, execution contexts, frames, requests, and target sessions
  must be treated as navigation-sensitive handles.

## Actions

### `capabilities`

Returns the selected ClosedAI tab, a connection id, `Browser.getVersion`, and
`Schema.getDomains`. This reports the protocol actually bundled with Electron rather than
assuming tip-of-tree support.

### `targets`

Returns `Target.getTargetInfo` for the selected tab plus `Target.getTargets`. Use
`Target.attachToTarget` with `flatten: true` before addressing an out-of-process iframe,
worker, service worker, or other child target.

### `command`

Sends any CDP `Domain.method` with its raw parameters. `tab_id` defaults to the active
ClosedAI tab. `session_id` routes to a flat child-target session.

Two families are refused with a pointer to the purpose-built tool: `Input.*` (use the `page`
verbs — telemetry showed a model issuing 708 `Input.dispatchKeyEvent` calls to type text) and
`Page.captureScreenshot` (returns base64 as a text result and bypasses the screenshot budget;
use `closedai_ui` capture). The `protocol` tool is also marked `deferLoading`, so its schema
stays out of the model's context until it searches for it.

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
frames that require their own flat target session are surfaced as uninspected frames; automatic
OOPIF session ownership is a subsequent layer rather than an implicit fallback.

## Deliberately deferred

Security classification, command allowlists, user approvals, and human/agent interaction
arbitration are not part of this foundation. They should be layered above the transport without
changing its tab/session lifecycle model.

## Primary references

- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [CDP Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/)
- [CDP Runtime domain](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)
- [Electron Debugger](https://www.electronjs.org/docs/latest/api/debugger)
- [Electron WebContents](https://www.electronjs.org/docs/latest/api/web-contents)
