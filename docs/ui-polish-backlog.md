# UI polish backlog

Updated: 2026-09-21. Tracks the UI review and subsequent owner decisions. Review suggestions
are candidates, not instructions to implement them all. Tackle one agreed item at a time.

## Guiding decisions

- UI clutter is the enemy. Prefer removing, hiding, or consolidating sections and controls.
- Keep the composer without a Send button for now.
- Prefer contextual phantom text in the existing input over another label, row, or control.
- Reassess each suggestion against these principles before starting it.

## Completed items

- [x] Composer keyboard hints: idle “Enter to send · Shift+Enter for newline”; collapsed idle
  “Enter to send”; running “Esc to pause.” Use the existing placeholder styling and footprint.
  Drafts hide the hint; connection/unavailable messages still appear while idle.
- [x] History/search selections open a new tab in the focused tile, preserving the current chat
  and draft. A chat already open is selected in place instead of duplicated; split geometry stays put.
- [x] Close/hide tooltips clarify that tasks are not stopped. Brief feedback after a tab closes
  or a pane hides identifies continuing or paused tasks, without permanent controls or layout shifts.

## Candidates awaiting selection

| Area | Candidate to revisit |
| --- | --- |
| Composer actions | Clarify or consolidate new-chat and attachment actions. |
| History | Clear orientation and a return-to-conversation action; evaluate consolidation with search. |
| Close/hide/archive | Revisit archive recovery and Ctrl+W (currently closes the window). |
| Layout | Make existing split/maximize actions discoverable; consider consolidation or presets. |
| Click targets | Increase small tab-close hit areas without increasing visible icon size. |
| Visual hierarchy | Clarify the focused chat and secondary text with restrained contrast. |
| Empty chat | Assess whether optional first-use guidance earns its space. |
| Search | Clarify title-only scope; consider project filters or conversation-content search. |
| Activity | Make running/paused/completed states understandable without adding a status section. |
| Project selector | Improve “New project” wording and per-chat/queued scope. |
| Model picker | Clarify model/effort and consolidate access to frequent selections. |
| Appearance | Evaluate numeric entry, presets, or a sample only if they simplify adjustment. |
| Browser | Review tab overflow and browser-toggle discoverability at compact widths. |
| Tool configuration | Ensure change-effect copy matches current provider behavior. |
| Turn trace | Summarize outcomes before exposing detailed diagnostics. |
| Research library | Consolidate initial empty-state copy and defer validation until interaction. |
| Credential Vault | Make encryption wording conditional on actual keychain status; clarify entry naming. |
| Downloads | Verify populated progress, cancellation, and error/retry states before changing the panel. |
| Command palette | Evaluate as a way to consolidate existing actions. |
| Conversation outputs | Evaluate a compact way to recover generated files, images, and links. |
| Recovery | Consider reopen-closed-tab, layout restoration, and supported archive undo. |

## Review coverage still needed

The initial review visually inspected the live workspace and Appearance, and exercised other
main surfaces through preview controls. Populated diffs, file/image viewers, attachment errors,
context inspector, native failures, and systematic accessibility checks remain to be reviewed.
The preview's no-keychain warning is fixture state, not proof of the real machine's security state.
