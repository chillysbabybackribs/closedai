# Tools

Everything the app offers a model lives under `src/main/tools/`. Tools are provider-agnostic:
the registry is the single source of truth, and a provider adapter (Codex today via
`app-server-tools.ts`; others later) translates it to that provider's protocol.

## Three levels, three rules

Decide where a capability goes before writing it. Pick the lowest level that fits.

| Level | What it is | Add a new one only when |
|---|---|---|
| **Namespace** | A domain, e.g. `search`, `browser`. One directory. | The domain differs. |
| **Verb tool** | One tool to the model. Groups actions that share a result shape and a trust level. One `index.ts` per tool built with `defineActionTool`. | The result shape or the risk level differs (keep read-only and mutating actions apart). |
| **Action** | One verb inside a tool, e.g. `search`, `fetch`. One file. | Always the default answer for a new capability. |

Namespace names the app-server reserves for OpenAI's own tools are rejected at `thread/start`
(`browser` is one; the error names the collision). Prefix with what makes ours distinct,
e.g. `embedded_browser`.

Limits enforced at startup: snake_case names, unique names, non-empty descriptions,
`type: object` schemas, at most 8 actions per tool, and a field that appears in two actions
must have the same schema in both.

## Layout

```
src/main/tools/
  tool.ts              contract + argument helpers
  action-tool.ts       defineActionTool: many action files -> one tool
  registry.ts          validation, timeouts, error handling
  app-server-tools.ts  Codex adapter (dynamicTools + item/tool/call)
  manifest.ts          renderer-facing registry snapshot for the Tools modal
  telemetry.ts         recent call stats + JSONL persistence
  index.ts             createToolRegistry: registers every namespace
  <namespace>/
    index.ts           the namespace: its verb tools
    <tool>/
      index.ts         defineActionTool({ name, description, actions: [...] })
      <action>.ts      one ToolAction: verb, description, inputSchema, run
```

## Current namespaces

These are registered in `src/main/index.ts`, after the browser/capture accessors are created and
before the app-server starts.

| Namespace | Tool | Actions | Purpose |
|---|---|---|---|
| `embedded_browser` | `page` | `navigate`, `read_page`, `wait_for` | Browser-page inspection for the pane the user can see. It can open a URL or search query, wait for page readiness, and read visible text from the whole page or one selector. |
| `closedai_ui` | `capture` | `app_window`, `browser_page` | Visual evidence. `app_window` captures the composed Electron window, including chat and browser chrome. `browser_page` captures only one browser page after deterministic readiness checks. The model receives a scaled JPEG (max 1280x960); the full-resolution PNG goes to `ScreenshotStore` for the transcript. |
| `browser_cdp` | `page` | `inspect_page`, `click`, `click_at`, `type`, `press_key`, `scroll` | Agent-oriented page interaction: semantic element refs with real CDP mouse, keyboard, and wheel input. `type` inserts whole strings in one call; `press_key` sends chords. |
| `browser_cdp` | `protocol` | `capabilities`, `targets`, `command`, `events` | Raw Chrome DevTools Protocol escape hatch (`deferLoading`: out of context until searched for). `Input.*` and `Page.captureScreenshot` are refused with pointers to `page` and `capture`. See `docs/cdp-tool-foundation.md`. |
| `closedai_workspace` | `inspect` | `map`, `related`, `tests`, `ipc_flow` | Deferred, read-only navigation for this checkout. It queries a generated file index, direct relative import relationships, candidate tests, and preload-to-main IPC ownership without placing repository-derived data in developer instructions. |

The model-facing names intentionally differ from OpenAI reserved namespaces. For example,
ClosedAI uses `embedded_browser`, not `browser`.

## Writing an action

```ts
import { textResult } from '../../tool.js'
import type { ToolAction } from '../../action-tool.js'

export const search: ToolAction = {
  action: 'search',
  description: 'Search <provider>. Returns up to `limit` hits as "title — url — snippet" lines.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, description: 'Search terms.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 10.' }
    },
    required: ['query'],
    additionalProperties: false
  },
  async run(input) {
    // input is already validated against inputSchema (without `action`).
    return textResult('...')
  }
}
```

Descriptions are for the model: say what it does, when to use it over its siblings, and what
comes back. Return `failureResult(...)` for expected failures so the model can recover; throw
for bugs and the registry reports them.

## How the model sees it

One tool per verb tool. Its description is the preamble followed by one section per action,
and its schema is flat: an `action` enum plus every action's fields, each annotated with which
actions require or use it. At call time the registry validates against the chosen action's
schema, so errors are precise even though the advertised schema is the union.

Codex integration is in `app-server-tools.ts`. The registry is converted to app-server
`dynamicTools` for `thread/start` and `thread/resume`, and calls arrive as `item/tool/call`.
The adapter maps registry text results to `inputText` and image results to `inputImage`.

Codex extra: set `deferLoading: true` on a rarely used tool and it stays out of context until
the model searches for it.

## Results live in the thread history

The app-server replays the whole thread (every tool result, every image) to the model on every
turn, and only compacts by itself near the context limit. Three things keep that history small:

- The registry caps each text item of a result at `MAX_RESULT_TEXT_CHARS` (40k characters, about
  10k tokens) and appends a hint to narrow the request. Codex truncates shell output itself but
  passes dynamic tool output through untouched. CDP JSON results are capped tighter still at 20k
  characters (`cdp/result.ts`) because protocol dumps are the chattiest text source.
- Capture actions are capped at `DEFAULT_MAX_CAPTURES_PER_TURN` (8) images per turn across
  `app_window`, `browser_page`, and `crop`; past that the action fails with advice to read page
  state instead, and each image result reports how many are left. A capture scaled below 60% of
  its source width tells the model to crop for detail rather than capture again
  (`capture/budget.ts`, `capture/result.ts`).
- Capture actions return a bounded image to the model (image tokens scale with pixels) and keep
  the full-resolution capture in `capture/screenshot-store.ts`, keyed by the tool call id. The
  transcript looks the call id up when it renders the screenshot item and falls back to the
  model's copy once the store has evicted it (60 entries or 96 MB, newest kept).
- Measured 2026-09-02 across ~1,200 model steps: with prompt caching (median 98% of input
  tokens cached) a step after a tool result takes a median 2.7 s under 40k context and 3.4-4.0 s
  at 200k. Context size barely moves latency; the number of steps and the size of each tool
  result do. Each compaction costs 60-90 s and loses detail, so compaction is kept rare.
- `ChatService` watches `thread/tokenUsage/updated` and asks for `thread/compact/start` after a
  turn ends with the context above `chatCompactAtPercent` (default 80, 0 disables). One
  compaction per completed turn at most; sends wait for a compaction in flight. See
  `src/main/chat-context/context-compaction.ts`.
- Opt-in: `chatMidTurnCompactTokens` (default 0) launches the app-server with
  `-c model_auto_compact_token_limit=<n>` so Codex compacts mid-turn past `n` tokens. At 100k it
  fired every ~10 exec calls in a heavy turn, which is why it is off. See
  `src/main/chat-context/app-server-config.ts`.
- Codex 0.152 runs gpt-5.6 in code mode: the model calls tools from JavaScript inside a generic
  `exec` tool whose result budget defaults to 10k tokens per call (the model can raise it to
  20k), and a dynamic tool's result reaches that JavaScript as one string with any image inline
  as a data URL. The capture tool's description carries the exact `text()`/`image()` split so
  the model never dumps an image as base64 text (one such call cost 174k tokens before Codex
  truncated it). The developer instructions ask for `max_output_tokens` ≤ 4000 and targeted
  reads.
- Pasted screenshots are bounded to 1600x1200 JPEG before they are sent
  (`src/main/chat-attachment-images.ts`): Codex re-sends user messages verbatim through every
  compaction, so a full-size paste is paid for on every call for the life of the thread.
- "Continue in new chat" (chat header) leaves the thread behind entirely: the next message opens
  a fresh thread whose first turn carries a digest of the old one as `additionalContext`
  (`closedai.chat.handoff`, built from the app transcript without a model call, ≤12k chars).
  Tool output, screenshots, and reasoning stay in the old thread. See
  `src/main/chat-context/thread-handoff.ts`. The header shows the context percentage so the
  user can see when to reach for it.

## Seeing what exists: the Tools modal

The wrench button in the chat header opens the Tools modal (`src/renderer/tools/`). It reads
the registry as data (`manifest.ts`): every namespace, tool, and action, the exact description
and schema the model is sent, and which providers the registry is advertised to.

The same modal owns persisted enable/disable switches. A disabled plain tool is not advertised to
providers and calls are refused. A disabled action is removed from the action enum when the action
tool supports restriction; otherwise the call is refused if the model still tries it. Toggle state
is stored in `app-settings.json` and applied before each `ChatService` starts or resumes a thread.

## Telemetry

The registry reports every call to subscribers (`registry.subscribe`). `ToolTelemetry`
(`telemetry.ts`) keeps the last 500 records in memory and appends each to
`<userData>/tool-telemetry.jsonl`, so history survives restarts. The durable file is read in
full for its total call count, while recent records and stats stay bounded in memory.

A call record holds the tool, action, argument preview, duration, success, the failure text the
model saw, and the thread, turn, and call ids. Nested calls also carry `source`, `parentCallId`,
and `batchId`, so a `tool_batch` run can be reconstructed from its flat JSONL records. The
registry records failures from unknown, disabled, and invalid calls too, because reporting
happens after result normalization rather than only inside the tool implementation.

At startup the main process registers every tool and action definition with telemetry. New
definitions are appended as `tool_registered` events, so the observed tool catalog survives
restarts and can be refreshed by the Tools modal. Adding a namespace, tool, or action to the
registry is enough for it to appear in both the manifest and telemetry; tool implementations do
not need their own instrumentation.

The modal shows per-tool calls, failures, average time, last call, and recent calls with their
arguments and output; it updates live while open. "Clear telemetry" clears call history and
totals while retaining the observed tool catalog. This app-level telemetry does not automatically
include host orchestration calls that never enter `ToolRegistry` (for example shell or patch
operations); those require a host-side telemetry adapter, which can call
`ToolTelemetry.recordExternal` and `observeTools(definitions, 'external')` to use the same
durable stream and catalog.

Telemetry is best-effort. Subscribers must not break tool calls, and the registry swallows
subscriber errors after the model-visible result is produced.
