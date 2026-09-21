# Frida capability and ClosedAI integration assessment

Research date: 2026-09-20 America/New_York / 2026-09-21 UTC.
Repository baseline: `2d61205`, clean working tree when this review began.
Status: research and proposed design, not an implemented contract. No Frida installation,
process attachment, injection, kernel change, or benchmark was performed.

## Assessment

Frida would add a native instrumentation layer to ClosedAI: inspection and modification of
running machine code, process memory, threads, and runtime methods. ClosedAI already has a
substantial browser inspection layer. The useful integration combines those layers and preserves
their different identities and evidence; rebuilding browser capture or HTTP inspection in Frida
would add maintenance without establishing a new capability.

The full capability surface falls into five groups:

1. Device, process, session, and script orchestration through **frida-core**.
2. Native inspection, interception, memory operations, and instruction tracing through **Gum**.
3. JavaScript/TypeScript agents through **GumJS**, with optional language bridges and native code.
4. Alternative deployment through **Gadget**, remote servers/portals, and **Barebone**.
5. Higher-level applications such as protocol analysis, fault injection, coverage, and fuzzing,
   which require target-specific logic or another project on top of Frida.

Recommendation: design for all five groups, but first validate ordinary local userspace
instrumentation in a separate controller process. Make kernel/VM work an independently tested
backend. The September Barebone releases are substantial, but their prerequisites differ
materially from attaching to an ordinary application.

This is a capability-family assessment, not a claim that every API or platform was exercised.
The unresolved questions and proposed validation sequence below are part of the result.

## What is current, and what is historical

The official Frida release page and release API identified **17.18.0, published September 9,
2026**, as the current release during this conversation. Its compiler and language-server work
and Barebone expansion are described in the [17.18 announcement][release18].

Important compatibility boundaries:

- [Frida 17.0][release17] removed legacy enumeration forms, static module lookup methods, and
  old `Memory.read*/write*` methods. Use module instances and `NativePointer` methods. Copying
  an older tutorial verbatim is not a reliable implementation strategy.
- Java, Objective-C, and Swift bridges are now separate packages. The REPL and `frida-trace`
  bundle them for convenience; a custom agent must declare and compile the bridges it uses.
  That distinction matters when an experiment works in a terminal but fails through our SDK.
  See [bridge documentation][bridges].
- The [generated Core][core] and [Gum][gum] references are more useful for the complete public
  surface than introductory pages alone. Their displayed API namespace `1.0` is not the Frida
  product release number. Pin the host binding, agent/devkits, typings, and remote components
  together rather than treating rolling documentation as a lockfile.
- The current Modes page explains injected, embedded, and preloaded operation. Barebone needs
  the recent release notes and backend documentation as well; it is not adequately described
  by that introductory taxonomy.
- The 2026 Android performance paper reviewed here measured **Frida 16.7.19**, not 17.18.
  Publication date does not establish the age of its tested implementation.

## Capability map

### Host-side orchestration

The [Device API][device], [Session API][session], and [Script API][script] establish this surface:

| Area | Frida provides | ClosedAI implication |
|---|---|---|
| Discovery | Devices, processes, installed/frontmost applications, system parameters | Return a filtered inventory with durable target receipts; names alone are ambiguous. |
| Process control | Attach, spawn suspended, resume, kill, inject a library | Separate inspection from actions that change execution. |
| Early instrumentation | Device spawn gating and per-session child gating | Every held process needs a recorded owner and a release policy. |
| Agent lifecycle | Create/load/unload scripts, compile bytecode, script snapshots | A snapshot initializes an agent runtime; it is not a snapshot of the target's entire execution. |
| Communication | Agent messages, binary data, exported RPC, device channels/services | Use structured records and bounded binary chunks. |
| Session recovery | Detach reasons, crash/device-loss signals, persistence and resumption | Distinguish a resumed connection from a newly attached process. |
| Script control | Interrupt, terminate, debugger attachment, eternalization | Stopping JavaScript and undoing native side effects are different operations. |

Capabilities can be absent on a particular device/backend. In particular, process enumeration
does not imply permission to attach, and a USB connection does not imply a fully instrumentable
phone. Persistent and eternalized agents need explicit lifecycle treatment; they conflict with
an assumption that ending a tool call removes its effects.

### Native instrumentation inside a target

The following API families are documented in the [JavaScript reference][js] and [Gum reference][gum].
The rightmost column describes proposed uses and limitations, not built-in ClosedAI behavior.

| Family | Mechanism | Useful application or constraint |
|---|---|---|
| Process and thread inspection | `Process`, `Thread` | Identify loaded code and execution context; native threads are not browser tabs. |
| Module and symbol discovery | `Module`, `ModuleMap`, `ApiResolver`, `DebugSymbol` | Resolve locations; stripped/private symbols still require analysis. |
| Live discovery | Thread/module observers | Handle libraries and threads appearing after attachment. |
| Memory inspection | Pointer reads, range enumeration, scans | Inspect bounded buffers and structures; memory can change during a read. |
| Memory modification | Allocation, pointer writes, protection changes, code patching | Controlled fault injection; arbitrary writes have no automatic rollback. |
| Function interception | `Interceptor.attach` | Observe arguments, results, and native call stacks. |
| Function replacement | `replace`, `replaceFast`, `revert` | Substitute behavior; preserve ABI and allocation lifetimes. |
| Calling native code | `NativeFunction`, `NativeCallback`, `SystemFunction` | Expose a target's existing function as a callable experiment. |
| Instruction work | `Instruction`, architecture writers/relocators | Inspect and transform code when a function-level hook is insufficient. |
| Exceptions and watchpoints | Exception handlers, hardware break/watchpoints | Diagnose a particular access; hardware resources and support are limited. |
| Page-access observation | `MemoryAccessMonitor` | First access per monitored page, not a complete history of every load/store. |
| Native cost measurement | `Profiler` and sampler families | Attribute selected function cost; different from V8's page profiler. |
| Supporting APIs | Files, streams, sockets, SQLite, workers | The agent is executable code with target access, not a read-only query language. |

Important engineering consequences:

- Correct function signatures, calling conventions, object layouts, and pointer lifetimes must
  be established before calling or replacing a function. A readable address is not a type.
- Holding a target thread while doing expensive work changes timing and can cause deadlocks.
  A native callback may execute while the application holds locks.
- The [best-practices guide][practices] explains why replacing a string in place can overflow
  or touch read-only memory, and why allocated replacements must remain alive for as long as
  the target uses them. Managed agent code does not make arbitrary native access memory-safe.
- Unloading a hook cannot undo file writes, requests, or application decisions that already
  happened. A caught native exception does not prove the target remains in a valid state.
- Ordinary `Cloak` concerns visibility to cloak-aware introspection. It is not a universal
  invisibility guarantee. Recent kernel-assisted behavior has a broader scope and must not be
  confused with that ordinary API. No concealment feature is needed for our proposed first use.

### Instruction tracing and coverage

[Stalker][stalker] follows selected native threads and can emit calls, returns, basic blocks,
or instructions. Transformers and callouts allow instrumentation to be inserted into translated
code. Module exclusions and call summaries narrow the work. The architecture uses relocated
copies of basic blocks, with caching and branch handling; it is not simply an OS debugger
single-stepping every instruction.

For ClosedAI, this enables experiments such as: observe one native function, follow its thread
for that call, compare the executed blocks for two inputs, and retain a bounded trace. It does
not supply automatic source reconstruction, causal dataflow, whole-system coverage, or reverse
execution. Agent heap snapshots likewise do not provide `rr`-style record/replay.

Trace support must be checked per architecture/backend. JIT-generated or self-modifying code
needs attention to invalidation and trust thresholds. Correct stopping includes allowing the
thread to leave translated code before reclaiming its trace resources. Whole-browser
instruction tracing should not be the default workload.

### Runtime bridges and fast agents

[Official bridges][bridges] provide runtime-specific access to Java, Objective-C, and Swift.
They are separately packaged and independently versioned. Useful operations include resolving
runtime methods and working with objects where the bridge supports them; availability depends
on the target actually loading that runtime. Arbitrary .NET, Python, or other runtimes should
not be presented as first-party bridges merely because community integrations exist.

Gum can be used directly from C. GumJS also supports compiled C and Rust modules for hot
callbacks and other native work. Compilation/dependency availability varies by target;
Rust or external C compilation must not be assumed to work inside a restricted process.
The host compiler can bundle TypeScript agents and their dependencies. Frida 17.18 adds a
language-server API, useful for future probe editing, but unnecessary for the first backend.
See [C API][capi] and [release notes][release18].

### Deployment modes and their prerequisites

| Mode | How it reaches the target | What to establish first |
|---|---|---|
| Local injection | Host attaches to or spawns a process | OS permission, architecture, process identity, injection compatibility. |
| Remote/USB server | Host controls `frida-server` on another device | Compatible components, authenticated/restricted transport, target privileges. |
| Embedded Gadget | Target loads the instrumentation library | Control over the application build/package and relevant signing requirements. |
| Preloaded Gadget | Loader brings Gadget into an owned test process | Loader policy, startup behavior, explicit teardown. |
| Portal | Processes connect to a broker; controllers reach them through it | Broker ownership, authentication, per-node access, reconnect behavior. |
| Barebone | Debugger/VM/hardware transport or a resident kernel agent | Exact kernel/architecture/build and transport support; independent test environment. |
| Ahead-of-time grafting | `gum-graft` prepares supported Mach-O binaries | Binary modification and signing workflow; different from attaching to an untouched app. |

[Modes][modes] and [Gadget][gadget] document the first five. Gadget can listen, connect to a
portal, run one script, or load a script directory. Its defaults can block startup, and its
default minimal teardown is not full resource cleanup. On strict Apple signing configurations,
ordinary runtime interception is restricted; [gum-graft][graft] offers a separate prepared-binary
route. These are deployment decisions, not interchangeable connection strings.

Frida lists Windows, macOS, Linux, Android, Apple mobile platforms, FreeBSD, and QNX, but that
does not establish feature parity. Desktop/mobile signing and permissions, runtime versions,
CPU architecture, and backend must all be part of a capability report. A successful attach
should be followed by individual feature checks rather than a single global `supported: true`.

### What the 2026 Barebone work adds

[17.11][release11] expanded VM/kernel instrumentation and hardware-debugger integration.
[17.17][release1717] added a Linux kernel-module form of the agent. [17.18][release18] broadened
guest-process workflows and Linux injection architectures, added an XNU kernel-extension form,
and exposed Linux BTF type information for querying kernel layouts from scripts.

This supports a much deeper investigation than page JavaScript: supported guest processes and
kernel code become instrumentation targets. It does not grant access to arbitrary machines.
The required execution/debugger/module access exists before these operations are possible.

The [Linux agent README][kmod] documents kernel-specific build inputs, symbols, ABI constraints,
and privilege requirements. Its kernel-module section names x86_64/arm64, while release notes
describe wider injected-agent architecture coverage. Those are different configurations, not
evidence that the module works on every listed architecture. The README is rolling `main`
documentation and includes build examples from 17.17; match it against the chosen release.

Our Linux kernel is `7.0.0-31-generic`. Kernel-module compatibility with that build is untested.
The first implementation should not depend on loading a kernel module or changing system
debugging policy. Kernel access and userspace attachment deserve separate capability entries.

### Tools built on Frida, and capabilities that need more work

- `frida`, `frida-ps`, and `frida-ls-devices` support interactive exploration and discovery.
  [frida-trace][trace] generates editable function handlers and supports several selection
  methods. [frida-discover][discover] helps identify internal functions. These are useful
  learning/validation tools; SDK integration avoids parsing terminal output.
- TLS/protocol analysis requires locating the actual encryption or serialization boundary.
  A socket hook may see ciphertext. Chromium's library layout, stripped symbols, inlining,
  multiplexed connections, and IPC mean a generic `SSL_read` recipe is not guaranteed.
- File, database, IPC, and allocator investigations require target-specific probes and
  interpretation. Frida provides mechanisms, not an automatic semantic decoder for every ABI.
- Coverage-guided fuzzing is available through [AFL++ FRIDA mode][afl] and [LibAFL's Frida
  integration][libafl]. LibAFL documents coverage, comparison logging, sanitizer, and DrCov
  runtimes. These require a fuzzing harness and engine; installing Frida alone is not a
  complete fuzzer or vulnerability detector.
- AI can select experiments, construct probes, and correlate evidence. Neither a successful
  hook nor an AI explanation proves a causal relationship or an exploitable vulnerability.

## What ClosedAI already implements

The following are source observations, checked against implementation rather than inferred
from older proposal documents.

| Existing concern | Source | Reuse and boundary |
|---|---|---|
| Shared browser ownership | [BrowserService](../src/main/browser-service.ts), [BrowserTab](../src/main/browser-tab.ts) | Tab/view ownership and the shared `persist:browser` session already exist. |
| Session network record | [Observer](../src/main/browser-network/network-observer.ts), [log](../src/main/browser-network/network-log.ts), [access](../src/main/browser-network-access.ts) | Existing requests, headers, rules, fetch/cookies; 2,000-record default ring. |
| CDP targets and leases | [CdpSession](../src/main/cdp/cdp-session.ts), [BrowserCdpAccess](../src/main/cdp/browser-cdp-access.ts) | Existing child frame/worker capture and target lifecycle; these are not OS process handles. |
| Page API recording | [Recorder](../src/main/cdp/cdp-instrument.ts) | Records selected web APIs in documents; current worker limitation does not justify native injection by itself. |
| Browser profiling | [Profiler](../src/main/cdp/cdp-profile.ts) | JS/CSS/heap/CPU reporting stays here; native profiling is complementary. |
| Provider-neutral tools | [Contract](../src/main/tools/tool.ts), [registry](../src/main/tools/registry.ts), [composition](../src/main/index.ts) | Extend the shared registry; avoid provider-specific Frida implementations. |
| Ownership and concurrency | [Locks](../src/main/tools/resource-locks.ts), [batch compensation](../src/main/tools/batch/compensation.ts) | Existing protection is primarily per-call/browser-target; native session leases need more. |
| Durable evidence | [Artifact service](../src/main/investigations/artifact-service.ts), [runtime](../src/main/investigations/artifact-runtime.ts), [contracts](../src/shared/investigation-artifacts.ts) | Reuse storage and scoped retrieval; acquisition is currently CDP/file-oriented. |
| Helper lifecycle | [Process groups](../src/main/process-tree.ts), [shutdown](../src/main/index.ts) | Reuse helper ownership patterns, without treating instrumented targets as disposable helpers. |
| User/model visibility | [Manifest](../src/main/tools/manifest.ts), [application instructions](../src/main/chat-context/application-instructions.ts) | Future tools must appear in the existing manifest, switches, and model guidance. |

No Frida dependency was found in `package.json` or the lockfile, and no native Frida integration
was found in the searched source. `frida` and `frida-trace` were not on this shell's PATH; that
does not prove no copy exists elsewhere. Installed Electron is **44.1.1**; the shell runs
**Node 24.13.1, Linux x64**. The shell Node version is not Electron's embedded Node version.

The browser views request context isolation, no Node integration, and sandboxing, but Linux
startup explicitly adds `--no-sandbox` in [startup policy](../src/main/chromium-startup-policy.ts).
That existing owner decision remains unchanged. A future external controller still does not
isolate the consequences of an injected agent from its target.

## Integration decisions supported by the evidence

### 1. Preserve browser semantics and add native reach

Use existing CDP/session tools for DOM, page execution, HTTP bodies, browser storage, and
JavaScript profiling. Use Frida for native questions that these do not answer: a native parser's
arguments, allocation behavior, a library's internal call path, or a controlled native failure.
For simple process statistics, use Electron's existing [app metrics][appmetrics] first.

One useful combined experiment would be: mark a browser action, identify the relevant native
process, capture a selected function's arguments and native stack, and compare those events
with an exact CDP request. Timestamp proximity alone must be labeled correlation, not proof.

### 2. Make process identity explicit

[Electron distinguishes][webcontents] the renderer's OS PID from Chromium's internal process
id. Existing PDF accessibility code uses the latter for its own purpose; do not reuse it as a
Frida PID. `webContents.getOSProcessId()` can locate the main renderer; it is not a complete map
of subframes, workers, GPU, network service, utility processes, and shared renderers.

A proposed target receipt should bind device identity, OS PID, process creation identity,
executable identity, architecture, and an attachment generation. Browser associations should
include tab, WebContents, navigation generation, and verified frame/target mappings where
available. Record ambiguous/shared mappings instead of inventing one-to-one ownership.
Revalidate on navigation, crash, module unload, process exit, and reconnect; account for PID reuse.

### 3. Prefer a controller process, with a tested attachment path

The [official Node binding][nodebinding] makes Node a plausible controller. A dedicated process
would keep controller crashes, native-addon loading, and trace ingestion outside Electron main.
A Python controller is a reasonable fallback if packaging or cancellation is better supported.
Choose after a small binding/packaging validation, not by creating parallel implementations.

There is an immediate host constraint: `/proc/sys/kernel/yama/ptrace_scope` is **1**.
[Yama documentation][yama] explains the restricted relationship required for attachment.
A helper spawned by ClosedAI is generally a sibling of its renderer processes, not their
ancestor. Therefore, same user ownership and a correct PID do not prove the helper can attach.
Validate the chosen process relationship or an explicitly scoped permission mechanism; launching
an owned fixture from the controller is the simplest first test. Do not infer that direct SDK
loading, a utility process, or the existing Chromium flags settle this question.

Prefer a private IPC transport to the controller and structured SDK results. Remote server,
Gadget, and Barebone support can share the control model while retaining different prerequisites.
This recommendation reduces controller failure propagation; it cannot prevent an injected
probe from crashing the browser or a kernel probe from crashing its environment.

### 4. Separate query, lifecycle, recording, and mutation

A proposed `native_instrument` domain fits better than pretending Frida is CDP. Exact names
are provisional. Keep each action tool within the repository's eight-action contract.

| Tool responsibility | Example operations | Contract |
|---|---|---|
| Discovery/query | capabilities, devices, processes, session status | Bounded facts; report required access without attaching implicitly. |
| Session control | attach, spawn, resume, detach, release | Explicit target and owner; return stable session handles. |
| Inspection | modules, symbols, threads, bounded memory | Reads through an existing session; disclose that the session itself instruments the target. |
| Recording | start, status, read, stop | Filters, finite budgets, loss counters, and a cleanup lease. |
| Probe execution/mutation | load custom agent, RPC, call, replace, patch | Executable behavior; never label arbitrary scripts or RPC as read-only. |
| Evidence retention | retain selected trace chunks/manifests | Extend the existing investigation substrate. |

A bounded declarative probe can offer a useful observation contract. An arbitrary script can
call native functions, write memory, perform I/O, or persist changes; source-code scanning cannot
reliably turn that into a read-only tool. The repository's separation rule applies here.

### 5. Treat cleanup as a state machine

Track sessions, scripts, hooks, replacements, Stalker threads, watchpoints, observers, held
children, pending operations, and controller/device loss. A stop operation should return a
per-resource outcome, including anything it could not release.

Proposed order: stop producing events, disable further gating, explicitly release owned held
children, detach/revert owned instrumentation, flush evidence, unload agents, detach sessions,
then stop the controller. Exact ordering must be tested against each backend. Do not kill an
existing target merely because its instrumentation controller failed. Explicitly owned disposable
fixtures may have a separate termination policy.

The registry currently aborts and returns on timeout, releasing its per-call lock even if the
underlying operation ignores cancellation. That does not establish native cleanup. Native
operations need independent leases, deadlines, and status reconciliation. Reuse batch
compensation, but extend it beyond its current tab/action pairs to receipt-based resources.
Apply the same ownership rules to direct exec calls, pane closure, provider rotation, and quit.

Retain operation keys and outcomes for mutations. A retry after a lost response must inspect
whether attachment or hook installation already succeeded. Never silently repeat a native call
with unknown side effects. Cleanup should remove instrumentation; it must not promise to reverse
effects already caused by application code.

### 6. Keep trace volume away from model transcripts

Current CDP event storage is a 1,000-event ring with oversized event previews; the page recorder
defaults to 500 events. These are not instruction-trace storage systems. Current artifact quotas
are 32 MiB per artifact, 256 MiB per chat/project scope, and 1 GiB total.

Aggregate near the probe: counts, selected arguments, sampled stacks, durations, and bounded
buffers. Use binary transport for bytes. Supply explicit emitted/retained/dropped counters,
sequence ranges, filters, timestamps, and loss reasons. Avoid silently blocking a hot target
thread to wait for the model or disk.

Extend the existing artifact acquisition path for immutable trace chunks plus a manifest.
Record versions, target/build/module identity, relative addresses, probe source hash, acquisition
interval, configuration, and completeness. Do not create another archive or store native traces
as fabricated CDP responses. Source buffers, symbols, filenames, and strings remain untrusted
data, including any instructions found inside them.

## Research and whitepaper evidence

No single current official whitepaper found in this review documents the entire 17.18 suite.
The strongest evidence is a combination of current references, release notes, implementation
documentation, original engineering material, and a narrower empirical paper.

| Reading | What was checked | What it establishes / does not establish |
|---|---|---|
| [Scaling Android Hooking, ICISSP 2026][paper] | Methods and performance sections; visually inspected PDF pages 4 and 10, including Figure 3 | Heid, Balatoni, and Heider tested 430 hooks on a Pixel 7a/Android 14 using Frida 16.7.19 and LSPosed 1.9.3. Serialization, transport, hook cost, and stability matter. This is not a Frida 17.18/Electron benchmark. |
| [Anatomy of a code tracer, 2014][anatomy] | Original author's technical explanation | Explains Stalker's dynamic translation and caching motivation. Historical timings are not current performance guarantees. |
| [The engineering behind the reverse engineering, OSDC 2015][engineering] | Extracted presentation text, not slide-layout verification | Foundational injection/interception/tracing explanation. Historical concealment claims and example internals are not current guarantees. |
| [Official Stalker internals][stalker] | Introduction/use cases and relevant API/lifecycle material | Detailed native tracing architecture and constraints; not a complete backend compatibility test. |
| [AFL++ FRIDA mode][afl] and [LibAFL][libafl] | Project documentation | Demonstrate Frida as a component in real binary-only fuzzing systems; fuzzing still requires a harness and orchestration. |

The Android paper's Figure 3 contrasts a stable optimized Frida transport configuration with a
faster JNI configuration explicitly marked unstable. The design lesson is to measure useful
throughput and target behavior together. It does not support choosing an unstable path because
one throughput number is attractive. Its selected real applications were stress cases rather
than a representative sample of all applications.

## Proposed validation before committing to implementation scope

These are future experiments, not completed checks or authorization inferred from a paper.

1. **Binding and lifecycle fixture:** controller launches a tiny owned native program; enumerate,
   attach, load a trivial agent, exchange structured/binary data, unload, detach, and verify exit.
   Establish compatible versions and helper packaging first.
2. **Native semantics fixture:** known C functions and buffers demonstrate arguments, return values,
   stacks, one bounded scan, one controlled replacement, and cleanup. Verify against known outputs.
3. **Failure lifecycle:** cancellation during attach/load, target crash, controller crash, device
   disconnect, duplicate operation key, orphaned gated child, PID reuse, and a stuck agent.
4. **Electron mapping:** use a separate test Electron instance to verify renderer identity across
   navigation and crashes, multiple same-origin tabs, cross-origin frames, workers, and network
   service activity. Prove attachment under the chosen permission/process relationship.
5. **Compatibility and overhead:** measure baseline, attached idle, selected hooks, sampled stacks,
   and bounded Stalker tracing. Measure target latency, CPU/RSS, event loss, cleanup time, and app
   responsiveness. Exercise concurrent CDP profiling only after independent runs succeed.
6. **Protocol attribution:** target an owned fixture with known plaintext and request identifiers;
   show exactly which process/function saw it. Do not promise universal Chromium TLS capture.
7. **Advanced backends:** qualify remote/mobile/Gadget separately. Use a disposable VM for Barebone
   and validate the exact guest/kernel/architecture before considering integration into daily use.

## Outstanding decisions and limits

- Ordinary userspace attachment to this exact Electron build has not been tested. Existing
  Linux ptrace policy is a concrete constraint, not proof of success or failure for every design.
- Node binding packaging and forced cancellation need validation; generated API availability
  does not prove every binding exposes every new method in the selected release.
- Chromium native symbols, TLS boundaries, and process-to-tab attribution remain unresolved.
  Private symbol offsets cannot be assumed stable across Electron upgrades.
- An external controller cannot restore a target corrupted by arbitrary native writes or calls.
  Kernel instrumentation has a larger failure scope than userspace instrumentation.
- No performance, stealth, exhaustive coverage, or vulnerability-detection guarantee is justified
  by the documentation reviewed here.
- Research fetched several stale/nonexistent source paths; generated official Core APIs and the
  working backend README replaced them. No conclusion depends on those failed fetches.

The supported direction is therefore a native investigation backend with explicit targets,
bounded evidence, and owned lifetimes, integrated with existing browser and artifact services.
The validation sequence determines how much of the suite can be offered reliably on this host.

## Source index

[release18]: https://frida.re/news/2026/09/09/frida-17-18-0-released/
[release1717]: https://frida.re/news/2026/08/05/frida-17-17-0-released/
[release11]: https://frida.re/news/2026/06/05/frida-17-11-0-released/
[release17]: https://frida.re/news/2025/05/17/frida-17-0-0-released/
[core]: https://frida.re/docs/frida-core/
[gum]: https://frida.re/docs/gum/
[device]: https://frida.re/docs/frida-core/class.Device.html
[session]: https://frida.re/docs/frida-core/class.Session.html
[script]: https://frida.re/docs/frida-core/class.Script.html
[js]: https://frida.re/docs/javascript-api/
[modes]: https://frida.re/docs/modes/
[gadget]: https://frida.re/docs/gadget/
[graft]: https://frida.re/docs/gum-graft/
[bridges]: https://frida.re/docs/bridges/
[capi]: https://frida.re/docs/c-api/
[practices]: https://frida.re/docs/best-practices/
[stalker]: https://frida.re/docs/stalker/
[trace]: https://frida.re/docs/frida-trace/
[discover]: https://frida.re/docs/frida-discover/
[nodebinding]: https://github.com/frida/frida-node
[kmod]: https://github.com/frida/frida-core/blob/main/src/barebone/agent/linux/README.md
[afl]: https://github.com/AFLplusplus/AFLplusplus/blob/stable/frida_mode/README.md
[libafl]: https://aflplus.plus/libafl-book/advanced_features/frida.html
[webcontents]: https://www.electronjs.org/docs/latest/api/web-contents#contentsgetosprocessid
[appmetrics]: https://www.electronjs.org/docs/latest/api/app#appgetappmetrics
[yama]: https://www.kernel.org/doc/html/latest/admin-guide/LSM/Yama.html
[paper]: https://www.scitepress.org/Papers/2026/143195/143195.pdf
[anatomy]: https://medium.com/@oleavr/anatomy-of-a-code-tracer-b081aadb0df8
[engineering]: https://frida.re/slides/osdc-2015-the-engineering-behind-the-reverse-engineering.pdf
