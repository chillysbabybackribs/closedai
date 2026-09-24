# Agents tab redesign — 2026-09-23 (implemented the same day)

Scope: the Agents view tab (`view.agents`, `src/renderer/agent-library/`). Approved and built on
2026-09-23; `docs/application.md` is the current description. No HTML mock: the screens render
with the real registry components.

## Jobs

1. Pick a saved agent and start it (the common case; the library is seeded, so it is never blank
   on first open).
2. Build or edit one agent: name, cycle limit, standing instructions.
3. See what is running, and get to a run that needs the user (approval, failure, paused).

## What fails today

- The scope chip ("Following · chat") is view-tab chrome that does nothing here. Agents only
  uses scope to decide which tile the new run docks beside, and that is always the tile the tab
  lives in.
- The intro (title, lede, three numbered steps) is onboarding copy shown forever.
- Runs occupy the first fold on every open, even when there are none or they are all paused,
  and push the library and editor below.
- The library is a flat two-column table in a side rail; the editor is always open, so the
  first screen is "a blank form beside a list", which reads as a settings page, not a place you
  launch things from.

## Structure: one tab, three screens

Stack navigation, not tabs: Library is the root, Build and Runs are pushed screens with a
back affordance. Build is per-agent (New or Edit of one card), so it should not be a permanent
tab that holds "the current agent". Recommendation: this over a three-trigger shadcn Tabs bar.

### 1. Library (initial view)

```
┌ Agents                                     Runs · 2 paused    [ New agent ] ┐
│                                                                             │
│ ┌ Repair agent ───────────────┐ ┌ Docs sweep ────────────────┐              │
│ │ You are the continuously    │ │ Each cycle, open docs/ and │              │
│ │ running ClosedAI …          │ │ fix one stale paragraph …  │              │
│ │                             │ │                            │              │
│ │ running · cycle 31          │ │ Never run · 10 max         │              │
│ │            Edit     [Start] │ │            Edit    [Start] │              │
│ └─────────────────────────────┘ └────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
```

- Header is bare: the word "Agents", then on the right a ghost Button "Runs" carrying the
  existing `dockSummary` text ("2 paused", "1 running · 1 needs you"; plain "Runs" when there
  are none) and a default Button "New agent". Colored text for attention, no pill.
- Cards: shadcn `Card` (`src/components/ui/card.tsx`) in a
  `grid-cols-[repeat(auto-fill,minmax(260px,1fr))]` grid, compact spacing (`py-4 gap-3`).
  - `CardTitle`: the name.
  - `CardDescription`: the first lines of the instructions, clamped to two lines.
  - `CardFooter`: one muted line from `describeAgentUse` plus the cycle cap ("Never run · 10
    max"); when a run from this agent is live, the line becomes its state and cycle in
    `--ok-ink` (running) or the attention color (approval/failed), taken from the runs store
    by `agentId`.
  - Actions in the footer: ghost "Edit" and default "Start". Start is disabled with a title
    when `startEnabled` is false. Start docks the run beside this tile as today and stays on
    the Library; the card's footer line changes to "running · cycle 1".
- Order: live runs first, then most recently used, then never-run by name.
- Empty library (user deleted every card): shadcn `Empty` (add via
  `npx shadcn add empty`), title "No saved agents", one line "Build one and Save to keep it
  here", and the New agent Button. No numbered steps.

### 2. Build (New or Edit)

```
┌ ← Agents        New agent                                                   ┐
│ Name                                                   Cycle limit          │
│ [ Optional — blank runs once without saving ]          [ None ]             │
│ Instructions                                                                │
│ [                                                                          ]│
│ [                                                                          ]│
│ Delete            Unsaved changes                      Save     [ Start ]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

- Reached from New agent (blank draft, name focused) or a card's Edit (loaded draft).
- Header: ghost Button with `ArrowLeft` labelled "Agents" and the screen title ("New agent" or
  the agent's name). Back with unsaved changes keeps the draft in memory for the session so
  a mis-click does not lose the prompt; no confirm dialog.
- Body is the existing editor unchanged: Name, Cycle limit, Instructions, footer with Delete
  (two-click confirm), status line, Save, Start. All current rules stay: a named draft is
  saved before Start, a nameless draft runs once, prompt length cap, dirty tracking.
- Start returns to the Library so the new run's card shows live.
- Delete returns to the Library.

### 3. Runs

```
┌ ← Agents        Runs                                              2 paused  ┐
│ Agent            Status            Activity                                 │
│ ● Agent          Paused · Cycle 31 Paused by you        ▢ Resume  Stop      │
│ ● Repair agent   Paused · Cycle 2  Paused by you        ▢ Resume  Stop      │
└─────────────────────────────────────────────────────────────────────────────┘
```

- The existing `AgentRunOverview` table moves here as is ("for now"); the heading row is
  replaced by the screen header. Empty: shadcn `Empty`, "No runs yet", Button "New agent".
- Runs needing the user still sort first; the Library header's Runs label is the only place
  they surface on the root screen.

## Removals

- Scope chip: `WorkspaceView` renders no toolbar for `kind === 'agents'`; the view keeps
  following its tile. `view.scope*` manifest entries note the exception.
- Intro header (`agent-library-intro`, title, lede, steps) and its CSS.
- The saved-agent rail and its table CSS (`agent-library-rail`, `agent-library-table*`).
- The always-visible Runs section on the root screen.

## Components and files

| Piece | Source | Notes |
| --- | --- | --- |
| Cards | shadcn `Card` (present) | className overrides for compact spacing only |
| Buttons | shadcn `Button` (present) | sizes `sm` and `xs` as today |
| Empty states | shadcn `Empty` (add) | fix the `cn` import after the CLI writes it |
| Fields | shadcn `Input`, `Textarea` (present) | unchanged |
| Icons | lucide `Plus`, `ArrowLeft` | no Bot icon |

- `agent-library-view.tsx`: owns `screen: 'library' | 'build' | 'runs'` and the draft handoff.
- New `agent-library-cards.tsx` (+ test): header, grid, card, empty state.
- `agent-library-panel.tsx` becomes the Build screen: drop the rail, keep the editor and its
  test.
- `agent-run-overview.tsx`: heading removed; hosted by the Runs screen.
- `styles/agents/library.css`: shrinks to the view shell and the prompt field; card layout is
  Tailwind on the primitives.
- `src/shared/ui-controls.ts`: add `agents.card` (item id), `agents.edit` (item id),
  `agents.card-start` (item id), `agents.runs`, `agents.back`; keep the editor and run ids.
- `docs/application.md` Agents paragraphs and the workspace index regenerate.

## States to verify in the real build

Library populated with one live run; Library empty; Build new; Build edit dirty; Build delete
confirm; Runs populated; Runs empty; Start disabled (provider unavailable).
