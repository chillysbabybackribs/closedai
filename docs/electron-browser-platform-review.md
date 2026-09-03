# Electron + Chromium platform review and implementation status

Date: 2026-09-01. Sources: electronjs.org docs (`/docs/latest`, which documents Electron 44.1.1),
the Electron 43 and 44 release posts, the breaking-changes page, and local inspection of
`~/Desktop/appv1codeapp` (Electron 43.4.1 installed) and this machine (Ubuntu 24.04.4, kernel 7.0).
Every claim below is either quoted from those docs or measured locally; anything unverified is
marked **verify**.

This is a dated design record, not a declaration that every recommendation is implemented.
Section 4 compares the current checkout with the decisions and recommendations below.
External version/support statements retain the review date. For the wider application and
model integration, use [Application](application.md) and [Model context](model-context.md).

## 0. Owner decisions (2026-09-01) — these override the recommendations below

- **Sandbox: keep appv1's behaviour exactly.** `--no-sandbox` is appended on Linux
  (`chromium-startup-policy.ts` ported verbatim) and `ELECTRON_DISABLE_SANDBOX=1` stays in the dev
  launcher. §3.1 is recorded as the documented risk, not as a task. `app.enableSandbox()` is NOT called.
- **Permissions: no gate anywhere.** `setPermissionRequestHandler` → `callback(true)`,
  `setPermissionCheckHandler` → `true`, `setDevicePermissionHandler` → `true`,
  `setDisplayMediaRequestHandler` grants the requested screen/audio via `desktopCapturer`, and the
  `select-bluetooth-device` / `select-hid-device` / `select-serial-port` / `select-usb-device`
  events auto-select the first matching device. §3.2 is recorded as the documented risk, not as a task.
- Everything else in §3 remains the intended direction unless Section 4 marks it deferred or
  unverified. This sentence records owner intent; it does not mean the current checkout has
  completed every item.

## 1. Versions

| | Installed in appv1 | Latest stable | Notes |
|---|---|---|---|
| Electron | 43.4.1 | **44.x** (released 2026-08-25) | Support policy = latest 3 stable (44, 43, 42). 43 series EOL January 2027. 45 is in beta (Chromium 152→153). |
| Chromium | 150.0.7871.46 | 152.0.7977.54 | Electron tracks even Chromium majors, 8-week cadence. |
| Node | 24.17.0 | 24.18.1 | |
| V8 | 15.0 | 15.2 | |

**Decision: start closedai on Electron 44.** Nothing in the 44 breaking list touches this app
(clipboard module async + removed from renderers — we use `navigator.clipboard`; ANGLE statically
linked; macOS 12 / 32-bit dropped; `select-client-certificate` may pass `webContents: null`). What
44 adds that we want: `windowStatePersistence`, `webContents.setZoomMode`, system-themed Window
Controls Overlay icons on Linux frameless windows, PGO-tuned binaries, faster Linux startup
(FontConfig off-thread, GDK GL probe skipped), 37 MB smaller Linux distribution, spare-renderer
warm start for sandboxed windows.

## 2. Architecture confirmed by the docs

- **WebContentsView is the embed primitive.** The web-embeds guide: `<webview>` is "not
  recommended… undergoing dramatic architectural changes"; WebContentsView "offers the greatest
  control". appv1's model (native views positioned from renderer-measured bounds) is the documented
  pattern. Keep it.
- **One `persist:` partition for all tabs.** `session.fromPartition('persist:…')` returns the same
  Session for every caller; a login in any tab applies everywhere. Extensions require a persistent
  partition too. appv1's `PARTITION` in `browser-url.ts` is right.
- **Tab views get no preload.** Security checklist #20 ("do not expose Electron APIs to untrusted
  web content"). Tabs are plain Chromium pages; only the chrome renderer has a preload.
- **Renderer↔main via `contextBridge` + `ipcRenderer.invoke`.** Sandboxed preloads may import
  `contextBridge, crashReporter, ipcRenderer, nativeImage, webFrame, webUtils` — everything appv1's
  preload uses. So the chrome window can run `sandbox: true` (appv1 sets `sandbox: false`; nothing
  in its preload needs it).

## 3. Findings that change the build (ordered by severity)

### 3.1 CRITICAL — appv1 runs Chromium with `--no-sandbox` on Linux
`chromium-startup-policy.ts` appends `no-sandbox`; `dev:app` sets `ELECTRON_DISABLE_SANDBOX=1`.
Docs: "disables the sandbox for all processes (including utility processes)… only use this flag
for testing purposes, and **never** in production." Process-sandboxing guide: the sandbox is the
key mechanism for rendering untrusted content.

Measured root cause on this machine: Ubuntu 24.04 ships
`kernel.apparmor_restrict_unprivileged_userns=1`, so `unshare -Ur` fails (namespace sandbox
unavailable to unconfined binaries), and `node_modules/electron/dist/chrome-sandbox` is
`-rwxr-xr-x dp:dp` (not SUID root), so the SUID fallback aborts with "SUID sandbox helper binary was
found, but is not configured correctly". `--no-sandbox` was the shortcut around that.

Fix for closedai (both must hold):
1. Never append `no-sandbox`; call `app.enableSandbox()` before `ready` so no window can opt out.
2. Make the sandbox runnable:
   - dev: `postinstall` script that runs `sudo chown root:root node_modules/electron/dist/chrome-sandbox
     && sudo chmod 4755 …` (one prompt per `npm install`), **or** an AppArmor profile for the electron
     binary with a `userns,` rule — Ubuntu's documented path. Prefer the AppArmor profile: it survives
     reinstalls and doesn't need SUID.
   - packaged: ship `.deb` (postinst sets SUID on `chrome-sandbox`). Avoid AppImage/Snap, which cannot
     carry SUID and are exactly why so many Electron apps fall back to `--no-sandbox`.
3. Verify at runtime: a renderer's `/proc/<pid>/status` shows `Seccomp: 2` and `NoNewPrivs: 1`, and
   the app starts without the SUID abort. Add this as an automated smoke check.

### 3.2 HIGH — permission policy is "allow everything except notifications"
appv1: `setPermissionRequestHandler((_wc, permission, cb) => cb(permission !== 'notifications'))`.
Checklist #5 says handle permissions from remote content. Electron forwards every Chromium
permission type (39 listed in the session docs: `ar automatic-fullscreen background-fetch
background-sync captured-surface-control clipboard-read clipboard-sanitized-write display-capture
fileSystem fullscreen geolocation geolocation-approximate hid idle-detection keyboardLock
local-fonts local-network-access loopback-network media mediaKeySystem midi midiSysex nfc
notifications openExternal payment-handler periodic-background-sync persistent-storage pointerLock
screen-wake-lock sensors serial smart-card speaker-selection storage-access system-wake-lock
top-level-storage-access …`). Chrome's behaviour is deny-until-prompted for the sensitive ones.

closedai policy (no settings UI yet, so it must be a static table with a per-origin store added
later):
- allow: `fullscreen`, `pointerLock`, `keyboardLock`, `clipboard-sanitized-write`,
  `persistent-storage`, `screen-wake-lock`, `background-sync`, `mediaKeySystem`, `storage-access`,
  `top-level-storage-access`, `speaker-selection`.
- deny (until a prompt exists): `media`, `geolocation*`, `notifications`, `display-capture`,
  `clipboard-read`, `local-fonts`, `idle-detection`, `openExternal`, `hid`, `serial`, `usb`,
  `midi*`, `nfc`, `local-network-access`, `smart-card`, `payment-handler`, `ar`.
- Also install `setPermissionCheckHandler` with the same table (it governs synchronous checks),
  `setDevicePermissionHandler(() => false)`, `setDisplayMediaRequestHandler` that calls back with
  nothing (screen share denied cleanly instead of hanging), and cancel `select-bluetooth-device` /
  `select-hid-device` / `select-serial-port` / `select-usb-device`.

### 3.3 HIGH — `window.open` / target=_blank must become tabs, keeping the opener
Docs: `setWindowOpenHandler` gets `disposition` (`foreground-tab`, `background-tab`,
`new-window`, `default`) and the response supports `action: 'allow'` with a `createWindow`
callback that returns a `WebContents`, so the popup is adopted into our own `WebContentsView` and the
opener relationship (`window.opener`, `postMessage`) survives — which OAuth popups depend on.
appv1 has `browser-popup-bridge.ts` doing this; port it, and route dispositions: `background-tab`
→ open unselected, everything else → select. Deny `will-attach-webview` globally
(`app.on('web-contents-created')`) and default-deny window creation for any non-tab WebContents
(checklist #12–#14).

### 3.4 MEDIUM — restore full back/forward stacks, not just URLs
`navigationHistory.getAllEntries()` on shutdown and `navigationHistory.restore({ entries, index })`
before the first `loadURL` on launch: "best effort to restore not just the navigation stack but also
the state of the individual pages — for instance including HTML form values or the scroll
position". appv1's `browser-tab-session-store.ts` stores URL + active index only. Adopt the API;
keep the URL fallback for older records. Also: `contents.canGoBack/goBack/goForward/goToIndex` are
**deprecated** in favour of `navigationHistory.*` — use the new names throughout.

### 3.5 MEDIUM — Chrome-parity webPreferences for tab views
Defaults that differ from Chrome and should be set explicitly on every tab view:
- `autoplayPolicy: 'document-user-activation-required'` (Electron default is
  `no-user-gesture-required`; Chrome requires activation for audible autoplay).
- `enableWebSQL: false` (Electron still defaults to true; Chrome removed WebSQL).
- `safeDialogs: true` ("browser style consecutive dialog protection").
- `spellcheck: true` (default) + `session.setSpellCheckerLanguages([...])` on Linux (Hunspell;
  dictionaries download from a Google CDN unless `setSpellCheckerDictionaryDownloadURL` is set) and
  the documented `context-menu` → `dictionarySuggestions` / `replaceMisspelling` wiring.
- `sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
  allowRunningInsecureContent: false, experimentalFeatures: false`, no `enableBlinkFeatures`
  (checklist #2, #3, #6, #8, #9, #10).
- `backgroundThrottling: true` plus appv1's measured detach-from-content-tree trick for background
  tabs (`browser-tab-rendering.ts`: a hidden-but-attached WebContentsView still runs rAF at full
  rate; detaching takes it to zero frames while keeping the page alive). Keep that module verbatim.
- Zoom: leave `zoomMode: 'default'` — "per-origin basis… same as Chromium" — and wire Ctrl+= / Ctrl+-
  / Ctrl+0 via `before-input-event`, observe `zoom-changed` for Ctrl+wheel.

### 3.6 MEDIUM — events the tab must handle (docs list, diffed against appv1)
appv1 handles: `did-start-loading did-stop-loading did-start-navigation did-navigate
did-navigate-in-page did-finish-load did-fail-load page-title-updated page-favicon-updated
render-process-gone unresponsive will-prevent-unload destroyed context-menu`. Add for a human
browser:
- `responsive` (clear the "page unresponsive" state).
- `certificate-error` → `callback(false)` and show the error page; never `--ignore-certificate-errors`.
- `login` (HTTP basic auth) → a credential prompt; unhandled, basic-auth sites fail silently.
- `enter-html-full-screen` / `leave-html-full-screen` → collapse the chrome so video fullscreen
  covers the window.
- `media-started-playing` / `media-paused` / `audio-state-changed` → tab audio indicator, and
  `setAudioMuted` for a mute-tab control.
- `will-prevent-unload`: appv1 auto-dismisses it (agent-driven tabs). For a human browser, prompt;
  on tab close use `webContents.close({ waitForBeforeUnload: true })`.
- `update-target-url` → status-bar link preview (cheap, Chrome-like).
- `did-change-theme-color` → optional tab-strip tint.
- `found-in-page` + `findInPage` — later (Ctrl+F).

### 3.7 MEDIUM — session-level calls Chrome users expect
- `session.on('will-download')` + `DownloadItem` (pause/resume/cancel, `setSavePath`) — appv1's
  `browser-download-service.ts` already does this; port it and default to `~/Downloads` without a
  prompt, matching Chrome.
- `ses.setUserAgent(ua, acceptLanguages)` — set Accept-Language together with the UA so the wire
  identity is consistent (appv1 only rewrites the UA via `browser-identity.ts`).
- `ses.setCodeCachePath(<userData>/code-cache)` — persistent V8 code cache like Chrome.
- `ses.flushStorageData()` on quit (appv1 does) and `ses.clearData()` exists for a future
  "clear browsing data".
- `session.extensions.loadExtension(path)` must be called **every boot** (no longer remembered),
  unpacked only, subset of `chrome.*`. Out of scope now; the persistent partition keeps it possible.

### 3.8 MEDIUM — package-time hardening with Electron Fuses (`@electron/fuses`)
Flip when packaging: `RunAsNode=false`, `EnableNodeOptionsEnvironmentVariable=false`,
`EnableNodeCliInspectArguments=false`, `EnableCookieEncryption=true` ("by default the SQLite
database that Chromium uses to store cookies stores the values in plaintext" — one-way switch),
`OnlyLoadAppFromAsar=true`, `EnableEmbeddedAsarIntegrityValidation=true` (macOS/Windows),
`GrantFileProtocolExtraPrivileges=false` once the chrome renderer is served from a custom scheme
(checklist #18; appv1 uses `loadFile` in production, so this fuse stays enabled until that change).

### 3.9 LOW — window and theme
- Keep `frame: false` + CSS `app-region: drag` (identical UI). E44 alternative for later:
  `titleBarStyle: 'hidden'` + `titleBarOverlay` gives system-themed native controls on Linux.
- Add `name: 'main', windowStatePersistence: true` (E44) and delete custom bounds persistence.
- `nativeTheme.themeSource = 'dark'` so pages see `prefers-color-scheme: dark` and native dialogs,
  context menus, and file pickers are dark — required for "identical dark UI" beyond our own CSS.
- `Menu.setApplicationMenu(null)` before `ready` (performance checklist #8; also removes the
  default menu's accelerators that would otherwise shadow browser shortcuts).

### 3.10 LOW — GPU / Linux specifics
- Keep `scripts/launch-electron-vite.mjs`: it strips PRIME/Optimus offload env vars before the
  binary starts (Chromium snapshots env before JS runs). Still relevant on 44 even though ANGLE is
  now statically linked (the EGL visual mismatch is in the driver path, not the ANGLE library).
- `disable-accelerated-video-decode`: keep only while the measured zero-frame H.264 bug reproduces;
  re-test on 44 (Chromium 152) and drop the switch if fixed.
- Log `app.getGPUFeatureStatus()` once at startup so a CPU-rasterization fallback is visible.
- `--enable-features=SpareRendererForSitePerProcess`: keeps a warm renderer so a new tab does not
  wait for process launch; only applies to sandboxed views without `additionalArguments` /
  `enableBlinkFeatures` / `offscreen` — our tab views qualify, the chrome window does not (it uses
  `additionalArguments`), which is fine.
- `xdg-portal-required-version=999` + `GTK_USE_PORTAL=0` (appv1): keeps GTK file dialogs; keep.

### 3.11 Chrome-parity gaps that Electron cannot close (state them, don't fight them)
- **No Safe Browsing, no Certificate Transparency enforcement** — the sandbox doc says Electron
  disables both because they need Google's central services. Mitigation available later: a
  `webRequest.onBeforeRequest` blocklist.
- **No Widevine/DRM** — needs castLabs "Electron for Content Security" fork (latest seen
  `v42.0.0+wvcus`, lagging stock Electron). Netflix/Prime/Spotify-web DRM streams will not play.
- **No password manager / autofill** (only `<datalist>`); long-standing open issues. A future
  vault-backed fill is the only route.
- **No `chrome://` pages**, no translate, no sync.
- **Proprietary codecs ARE included** (H.264/AAC/MP3: Electron builds with `proprietary_codecs`),
  so MP4 video works.
- **Built-in PDF viewer** — **verify** in phase 4 that PDFs render inline in a sandboxed
  WebContentsView on Electron 44 (the `plugins` webPreference is documented as default `false`;
  whether the PDF viewer needs it must be tested, not assumed).
- **Site isolation** — docs describe Chromium-consistent process allocation, but whether
  cross-origin iframes get their own processes in Electron is **verify** (compare
  `webFrameMain.processId` across frames in phase 4).

## 4. Implementation status (source review 2026-09-03)

| Area | Status | Current checkout |
|---|---|---|
| Electron 44 scaffold | **Implemented** | `electron@^44` and Electron Vite are configured. There is not yet a packaging target or `.deb` pipeline. |
| Sandbox owner decision (§0/§3.1) | **Implemented as accepted risk** | Linux appends `no-sandbox`; the launch scripts set `ELECTRON_DISABLE_SANDBOX=1`. The chrome window also has `sandbox: false`; tab preferences request `sandbox: true`, but the process-wide switch remains authoritative. |
| Allow-all permissions (§0/§3.2) | **Implemented as accepted risk** | Permission request/check/device/display handlers allow access, and device-selection events choose the first candidate. There is no per-origin permission store or prompt. |
| Popup adoption (§3.3) | **Implemented** | Ordinary page windows become tabs, background disposition stays unselected, POST data is preserved, and OAuth/utility-window cases retain a native opener bridge. Native popup WebContents are also registered as app-owned CDP roots outside the tab strip. |
| Session restoration (§3.4) | **Partial** | Tab order, active tab, URL, and title persist, capped at 24 tabs. Back/forward entries are not serialized and `navigationHistory.restore` is not called. |
| Tab preferences and rendering (§3.5) | **Partial** | Context isolation, no Node integration, tab sandbox preference, background throttling, autoplay policy, WebSQL disablement, safe dialogs, and background-view detachment are present. Spellchecker language/configuration work is absent. Zoom is an Alt+wheel feature rather than the Ctrl shortcuts described above. |
| Browser event set (§3.6) | **Partial** | Core navigation, title, favicon, failure, crash, unresponsive, unload, and context-menu events are handled. Recovery on `responsive`, HTTP basic auth, HTML fullscreen, audio state/muting, link preview, theme color, and find-in-page are not implemented. Certificate failures use the navigation-error surface rather than a dedicated `certificate-error` handler. |
| Session services (§3.7) | **Partial** | Downloads, persistent code cache, request identity rewriting, cookie persistence, and storage flush are implemented. There is no extension loading or clear-browsing-data UI, and the exact `setUserAgent(ua, acceptLanguages)` plan is not used. |
| Package fuses (§3.8) | **Deferred** | `@electron/fuses`, ASAR fuse flipping, cookie encryption, custom-scheme migration, and the Linux post-install sandbox setup are not configured. |
| Window and theme (§3.9) | **Partial** | Frameless chrome, dark native theme, and removal of the application menu are implemented. `windowStatePersistence` is not configured. |
| GPU/Linux startup (§3.10) | **Partial** | The launcher scrubs GPU-offload environment variables, GTK portal switches remain, and accelerated video decode is disabled unless overridden. GPU feature-status logging and `SpareRendererForSitePerProcess` are absent; the video-decode workaround still needs the documented Electron 44 retest. |
| Verification (§3.11) | **Open** | Popup behavior has automated coverage. PDF rendering, site isolation, basic auth, fullscreen, persisted back/forward stacks, and the packaging/sandbox checks remain unverified or unimplemented. |

Recent browser additions outside the original matrix: the omnibox now searches/removes history
matches; CDP maintains a discovered target/session inventory with flattened auto-attach;
semantic input foregrounds regular tabs and waits for frames after switching. Capture and input
share frame-settling code. See [CDP](cdp-tool-foundation.md) for current raw-command and wrapper
boundaries; this source review does not close the live verification items above.
