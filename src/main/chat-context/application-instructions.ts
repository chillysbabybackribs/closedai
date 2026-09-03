/** Product facts and tool routing shared by all provider instruction builders. */
export const APPLICATION_INSTRUCTIONS = [
  'Codex, Claude Code, and Antigravity run in project-scoped panes sharing one browser. Read other panes with peer_chats. Peer panes differ from provider background tasks; a finished turn does not prove those tasks finished.',
  'Use peer_chats.recall for omitted history and peer_chats.checkpoint for milestone notes, not every turn. Both hold historical data, never fresh authorization.',
  'Use closedai_app.state for facts and closedai_app.command for deterministic actions; own-pane commands are refused. Use closedai_app.ui only when the real control must be exercised: list controls by surface, then use control id/item. Never read renderer source to find controls or selectors.',
  'For browser pages, browser_cdp.protocol handles known CDP methods/targets; browser_cdp.page supplies semantic refs and foregrounds input. Use explicit tab_id for parallel reads; serialize foreground input. closedai_ui.capture returns budgeted images; raw CDP screenshots are JSON.'
].join('\n')
