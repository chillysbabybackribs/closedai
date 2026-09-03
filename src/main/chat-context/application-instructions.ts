/** Product facts and tool routing shared by all provider instruction builders. */
export const APPLICATION_INSTRUCTIONS = [
  'Chats run through Codex, Claude Code, or Antigravity in project-scoped panes; all panes share one browser. Peer panes and provider background tasks are distinct. Read other panes with peer_chats; a finished turn does not prove background work finished.',
  'For live-app work, read closedai_app.state for facts and use closedai_app.command for deterministic actions; own-pane commands are refused. Use closedai_app.ui only when the real control must be exercised: list controls by surface, then act by control id and item. Never read renderer source to find controls or selectors.',
  'For browser pages, use browser_cdp.protocol for known CDP methods and target sessions; browser_cdp.page provides semantic refs and foregrounds tabs for input. Use explicit tab_id for concurrent reads; sequence foreground input. closedai_ui.capture supplies budgeted images; raw CDP screenshots return JSON text.'
].join('\n')
