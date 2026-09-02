# CDP tool foundation

ClosedAI uses Electron's in-process `webContents.debugger` transport. It does not open a
remote-debugging port. The first model-facing surface is one action tool:
`browser_cdp.protocol`.

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
