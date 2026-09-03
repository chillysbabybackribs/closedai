# Composer design QA

Record status (2026-09-03): this preserves the earlier implementation's QA evidence and visual
capture blocker. It is not a live verification of the current composer. Project switching now
saves/restores pane sets, and the project rail includes a working timer; current behavior is
documented in [Application](docs/application.md). The results below retain their original scope.

## Evidence

- Source visual truth: `/tmp/codex-clipboard-42b430b4-3da4-4303-b92e-5b575288307f.png` (736 × 212 px), showing the current ClosedAI composer with the project rail intended to sit 16 px inside the prompt surface on both sides.
- Intended implementation state: idle, empty ClosedAI chat with the project strip, Tools, and Turn trace controls visible.
- Implementation capture: unavailable. The local Electron preview is running, but this environment did not expose a controllable application or browser surface to capture it. The available computer-use session reported no app surface, so there is no rendered screenshot to compare at the matching viewport.

## Required fidelity surfaces

- Fonts and typography: implemented with the application’s existing Inter UI font; no rendered capture was available to check optical weight, wrapping, or rasterization.
- Spacing and layout rhythm: the new 52 px project rail overlaps the composer card by 10 px, matching the reference’s connected, staggered silhouette. Rendered spacing is unverified.
- Colors and visual tokens: uses the existing dark composer ramp (`#1e1e1f` rail, `#252526` composer) and neutral white text. Rendered contrast is unverified.
- Image quality and asset fidelity: no non-standard raster assets appear in the target; the implementation uses the existing Lucide icon library for standard interface controls.
- Copy and content: Project, New project, Don’t work in a project, Tools, and Turn trace are implemented. The reference’s access text, Local, and branch labels are intentionally absent.

## Primary interactions checked

- Static/type verification: `npm run typecheck` passed.
- UI-control contract verification: `src/shared/ui-controls.test.ts` passed.
- Project workspace lifecycle verification: `src/main/chat-peers/peer-manager.test.ts` passed, including selecting a directory, replacing stale panes, and exposing the updated working directory.

## Findings

- [P1] Browser-rendered visual comparison is unavailable.
  - Evidence: no application/browser surface was exposed for screenshot capture.
  - Impact: the source and implementation cannot be compared at the same viewport, so visual fidelity cannot be certified.
  - Fix: open the local Electron preview in a controllable desktop/browser surface, capture the idle composer at the reference viewport, then compare the full view and focused strip/menu region.

## Comparison history

- Initial pass: blocked before visual comparison because no implementation screenshot could be captured.
- Follow-up: narrowed the project rail by 16 px on each side to match the reviewed update; visual capture remains unavailable.

## Final result

blocked
