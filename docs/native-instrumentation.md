# Native instrumentation

Initial implementation: 2026-09-20. This is a local Linux userspace backend with finite
experiments, using the pinned Frida 17.18.0 Node binding. It does not implement the whole
[capability assessment](frida-capability-assessment-2026-09-20.md).

## Runtime and tools

`src/main/native-instrument/` owns the external controller, process identity checks, retained
events and operation receipts. `src/main/tools/native-instrument/` exposes the same tools to
all providers through the existing registry and Tools switches. There is no new renderer IPC.

- `native_instrument.query capabilities` reports the platform, pinned version, current Yama
  policy and limits. It does not load the binding or claim a target is instrumentable.
- `query processes` filters same-user processes by pid/name/executable and returns bounded
  discovery results. Target ids include Linux boot id, pid, process start ticks, executable
  path and executable device/inode. Discovery never attaches. The controller checks identity
  immediately before and after attachment; this is not an atomic kernel process handle and
  cannot prevent every concurrent exec race.
- `inspect` attaches and loads a fixed module/thread inspection agent, with a module filter.
  It returns up to 20 matching modules and 20 thread ids/states, subject to event budgets.
  Even fixed inspection injects code and can disturb the target.
- `probe` attaches and executes custom Frida JavaScript. `send(payload, arrayBuffer)` provides
  structured/binary results. Custom code has native target privileges and can change memory,
  call functions, perform I/O or crash the target; it is not a sandbox or a read-only query.
- `query operation` reads receipts owned by the calling chat pane. A repeated operation key
  with identical arguments reuses the original promise/result; different arguments are rejected. Receipts
  survive provider rotation in this app lifetime, but not app restart. A missing receipt
  after restart does not establish that an earlier probe never ran.

Every experiment requires an explicit target and operation key. The main process admits only
the calling pane's active turn, rechecks its identity during execution, rejects simultaneous
operations on the same target, and allows at most two controllers. It retains at most 256
operation receipts for the app lifetime and refuses further operations instead of evicting
keys that could then accidentally execute again. Receipts are keyed by chat pane; other panes
cannot read them.

Each operation forks the built `native-controller.js` with Electron's own executable in
`ELECTRON_RUN_AS_NODE` mode. Only that helper imports the Frida native binding. The main process
remains responsible for receipt ownership and cancellation. Native binding compatibility was
checked with Electron 44.1.1's Node 24.19.0 on Linux x64. Packaged distribution/ASAR handling
has not been qualified; the current checkout build is the tested deployment.

## Bounds and cleanup

Collection lasts 0–10 seconds after script loading. The helper has an independent 14-second
abort deadline and exits after 18 seconds. Main also kills an unresponsive helper after
19 seconds, or after a 4-second cancellation grace. Tool timeout is 22 seconds. Turn
replacement, cancellation, window disposal and app quit release owned operations; loss of
the parent IPC channel cancels the helper. No session, gated child or suspended target is
intentionally kept between calls. Existing targets are never killed by the controller.

Cleanup first attempts script interruption after cancellation, then uses fresh cancellation
budgets for script unload, session detach and device-manager shutdown. Results report
each cleanup outcome. If the helper disappears without a result, the receipt is `unknown`,
with unconfirmed cleanup; the system does not silently retry. Detaching cannot reverse
native writes, I/O or decisions already made by the target, and process separation cannot
protect a target from a bad injected agent.

The controller retains at most 64 events and 10,000 bytes of compact event JSON. Individual
large messages become marked previews; binary payloads retain at most 512 bytes with their
original length. Results include received, dropped and truncated counts. These are host
retention limits, not a bound on Frida's upstream transport, target CPU or arbitrary agent
memory. Aggregate high-frequency observations inside the agent. Logs use the same collector.
Results contain source SHA-256, target identity and the pinned binding version. Output remains
untrusted data. Durable artifact retention and streamed event retrieval are not implemented.

## Local validation

The disposable C fixture exports a known integer function and accepts input over a pipe.
It can nominate the test runner with `PR_SET_PTRACER`, covering the runner's controller
descendants without changing global Yama policy. The user separately set this host's
`ptrace_scope` to `0`; the implementation never writes that setting.

Run the targeted unit tests with the repository's standard command:

```sh
node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs --test src/main/native-instrument/native-instrument.test.ts
```

Build the controller, then exercise the actual registry and Frida helper against the fixture:

```sh
npx electron-vite build
CLOSEDAI_NATIVE_EXECUTABLE="$PWD/node_modules/electron/dist/electron" node --experimental-transform-types --import ./scripts/ts-resolve-hook-register.mjs scripts/native-instrument/live-check.ts
```

The live check compiles the fixture in a temporary directory and removes it afterward.
Its checks cover discovery, inspection, arguments and return values, controlled return
replacement, binary messages, hook removal, duplicate receipts, event overflow, stale identity,
agent errors, cancellation, a stuck agent, the independent controller deadline and target exit.
It targets no browser or user app. The final Electron-runtime run passed all nine check groups,
including ten consecutive attach/inspect/detach cycles. Stuck-agent cancellation confirmed
script unload, session detach and device-manager closure. Typecheck, 6 targeted unit tests,
the checkout production build, hygiene and workspace-index checks also passed.

An early direct experiment timed out when Node both owned the fixture child and attached to
it in the same process, at both Yama settings. Frida spawn succeeded at setting `1`, and
attachment from a separate controller succeeded at setting `0`. The contrast suggests process
ownership/wait handling matters; it does not establish the precise cause of that timeout.
The live check uses a separate controller. Main-executable export lookup also failed on the
fixture despite its exported ELF symbol; the verified probe resolves its symbol through
`Process.mainModule.enumerateSymbols()`.

An intermediate implementation exited its helper after session detach without explicitly
closing the device manager. One repeat run crashed the fixture during a later attachment.
The final controller owns and closes its manager, and interrupts cancelled scripts before
unloading. The final repeated-cycle run passed; that establishes the tested outcome, not a
universal explanation or guarantee against native target crashes. The earlier hung-agent
test also left cleanup unconfirmed before interruption was added. Those failures are why
unknown receipts remain part of the contract.

### Restarted-app Chromium validation

On 2026-09-20, the restarted app exposed all three native tools and reported Frida 17.18.0
with `ptrace_scope=0`. A disposable data-URL tab was tested through the actual model tool
route against Chromium 152.0.7977.65 on Linux x64. A short CDP `devtools.timeline` trace
identified the renderer PID by matching an `EvaluateScript` event's frame id to
`Page.getFrameTree`; tracing completed without data loss before native attachment.
Process discovery then supplied the birth/executable-bound native target id.

Fixed inspection found 103 modules, returned the matching libc module and thread inventory,
and completed in 277 ms. A custom probe hooked libc `getpid`, invoked it three times from
the agent, observed the expected renderer PID on all three returns, removed the hook and
verified another call succeeded without adding a hit. Its binary event retained bytes
`01 02 03` without truncation. Reusing the same probe key and arguments returned the identical
receipt. Three further inspect/attach/detach cycles completed in 264–291 ms. Every operation
reported script unload/destruction, session detach and device-manager closure, with no event
loss. Page JavaScript responded correctly after each experiment. The disposable tab was
closed and the original browser tab restored.

This verifies finite inspection, controlled native calls/hooks and receipt reuse on one
renderer under this app's current launch configuration. It does not qualify sandboxed
Chromium configurations, GPU/network processes, arbitrary native hooks, page-to-native
causal attribution or performance overhead. The hook calls originated in the agent, not
page activity. Frame/PID correlation used existing CDP evidence for this experiment; there
is still no dedicated browser-to-process mapping API.

Remote/mobile devices, arbitrary program spawning, persistent sessions, host RPC, native
evidence archives, a dedicated browser-to-process mapping API, kernel/Barebone work and
performance benchmarks remain future work. Other applications and Chromium process types
still require target-specific validation. Restart the built app after changing its tool registry.
