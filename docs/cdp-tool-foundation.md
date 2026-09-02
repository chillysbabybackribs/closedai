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
