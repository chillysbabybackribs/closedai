# Operations → Runs production design QA

## Evidence

- Source visual truth: Untitled UI dark informational-page “Trade history” reference, full-view capture `exec-ade725bb-e9ca-417b-a63f-7580cdc8c66b`.
- Implementation: ClosedAI production renderer served from the production build at `http://localhost:4174/`, full-view capture `exec-7746ee18-bb32-479d-93e5-6ea10d5d46e3`.
- Comparison viewport: 1413 × 687 CSS px, `deviceScaleFactor: 1` for both source and implementation.
- Source pixels: 1413 × 687 CSS px captured and displayed as 1280 × 622 px.
- Implementation pixels: 1413 × 687 CSS px captured and displayed as 1280 × 622 px.
- Density normalization: equal CSS viewport and equal display scaling; no density-only differences were filed.
- State: dark desktop Operations → Runs, All tab, no drawer or popover open.
- Responsive evidence: 900 × 700 CSS px capture `exec-7f4ead50-ef81-4fc1-a9de-9c45cfba25db`.

## Full-view comparison

The source and implementation were opened together in one comparison input at the same viewport. The implementation preserves the source’s vertical navigation, breadcrumb/header hierarchy, compact control row, restrained dark borders, purple primary action, dense data table, and status text-plus-color treatment. The Operations metrics strip is an intentional product requirement that is absent from the generic source. The narrower sidebar and denser rows are intentional adaptations to ClosedAI’s compact desktop material and the approved prototype.

No actionable P0, P1, or P2 full-view mismatch remains.

## Focused table comparison

- Source table crop: `exec-9237286b-c2b3-4458-bae6-0988def1590e`.
- Implementation table crop: `exec-b46b2253-1c5e-4cd9-8e25-4a42f0589b4e`.

The focused crops were opened together. Header contrast, row dividers, checkbox placement, two-line primary/secondary labels, status pills, column alignment, and row-action rhythm are visibly consistent with the reference. The implementation deliberately fits more rows per screen than the reference to preserve ClosedAI’s established desktop density.

## Required fidelity surfaces

- Fonts and typography: Inter Variable is bundled and used throughout. Weight, hierarchy, small-control sizing, letter spacing, truncation, and antialiasing are coherent with both the reference and ClosedAI. No broken wrapping or cramped persistent label was observed.
- Spacing and layout rhythm: the sidebar/main grid, page margins, metrics, tab/toolbar separation, table radii, and drawer spacing remain aligned and stable. At 900 px, metrics become a 2 × 2 grid, filters move below the tabs, and the dense table remains horizontally scrollable rather than collapsing columns.
- Colors and visual tokens: neutral graphite surfaces, restrained hairlines, purple interaction accents, and semantic amber/green/red status colors map cleanly to the source. Status meaning is also expressed in text and iconography.
- Image quality and asset fidelity: the Runs view contains no required raster product imagery. All visible UI symbols use the existing Lucide icon system; no placeholder imagery, CSS illustrations, emoji, or handcrafted SVG art substitutes were introduced.
- Copy and content: Operations-specific labels, metrics, checkpoints, statuses, run details, worker-message language, and empty-state copy are coherent and task-focused. “Needs attention” remains more prominent than vanity analytics.
- Icons: icon family, stroke weight, size, alignment, disabled state, and selected purple treatment are consistent across the title bar, sidebar, toolbar, metrics, table, and overlays.
- Accessibility and states: semantic buttons, tabs, dialogs, labels, text-plus-color statuses, focus outlines, Escape dismissal, disabled future navigation, search, selection, empty state, popovers, and form-disabled states are present.

## Primary interactions tested

- Opened a run from its table row.
- Switched the run detail between Overview and Browser.
- Opened contextual worker chat, entered an instruction, sent it, and verified the message appeared.
- Verified one Escape closes worker chat while preserving the run detail beneath it.
- Opened the New worker dialog, entered a task, created it, and verified the new run detail opened.
- Exercised status tabs, date and quick-filter popovers, search, and selection during the approved prototype pass; the production controls retain those behaviors.
- Reloaded with Runtime and Log instrumentation enabled; no runtime exceptions or application log errors were emitted.

## Comparison history

### Iteration 1

- [P2] Overlay dismissal hierarchy: Escape in worker chat also dismissed the underlying run detail because both dialogs listened at the window level.
- Fix: added an `escapeEnabled` gate to the run-detail drawer and disable its Escape listener while worker chat is open.
- Post-fix evidence: browser inspection after one Escape reported `workerChat=false` and `runDetail=true`; the Browser detail tab remained reachable afterward.

### Iteration 2

- Rebuilt and recaptured the implementation at the matched 1413 × 687 viewport.
- Compared the full views and focused table regions together.
- No actionable P0, P1, or P2 findings remained.

## Open questions

- Live run data, durable worker messaging, approvals, and non-Runs navigation remain intentionally outside this UI-shell slice. Their disabled states are explicit rather than misleading.

## Implementation checklist

- [x] Full-window Operations mode beneath the native title bar.
- [x] Chat remains the default production mode.
- [x] Native browser surface is explicitly hidden when Chat unmounts.
- [x] Runs metrics, tabs, search, date, filters, table, selection, and empty state.
- [x] Run detail sections and Pause, Rerun, Stop, and Message worker actions.
- [x] Contextual worker-chat drawer and New worker flow.
- [x] Responsive desktop layout and semantic status treatment.
- [x] Production build, visual comparison, interaction pass, and console check.

## Follow-up polish

- [P3] Once real run volume is connected, validate long repository names and unusually long checkpoints against the current truncation widths.

final result: passed
