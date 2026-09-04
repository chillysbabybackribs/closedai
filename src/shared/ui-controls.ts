// The stable control map of the ClosedAI renderer. Every interactive control carries a
// `data-ui` id from this list (and `data-ui-key`, surfaced to models as `item`, when it repeats per row, tab, or menu entry), so a
// model drives the real UI by id instead of discovering it from an accessibility dump. The
// guard test beside this file keeps the renderer source and this manifest in step.

export const UI_CONTROLS = {
  'titlebar.drawer-toggle': 'Open or close the side drawer',
  'titlebar.menu': 'Application menu tab; item is file, edit, view, or help',
  'titlebar.menu-item': 'Application menu row; item is the slugged label, for example new-chat',
  'window.minimize': 'Minimize the window',
  'window.maximize': 'Maximize or restore the window',
  'window.close': 'Close the window',

  'drawer.new-agent': 'Start a new agent chat pane',
  'drawer.search': 'Search previous chats (combobox)',
  'drawer.search-clear': 'Clear the drawer search',
  'drawer.search-result': 'Drawer search hit; item is the row id',
  'drawer.row': 'Open a running, review-queue, or history chat; item is the row id',
  'drawer.row-twisty': 'Show or hide the sub-agents of a row; item is the row id',
  'drawer.row-settled': 'Show or hide settled sub-agents; item is the row id',
  'drawer.row-stop': 'Stop a running agent row; item is the row id',
  'drawer.row-close': 'Close an open pane row, keeping its thread in History; item is the row id',
  'drawer.row-delete': 'Ask to delete a history row; item is the row id',
  'drawer.row-delete-confirm': 'Confirm deleting a row; item is the row id',
  'drawer.row-delete-cancel': 'Cancel deleting a row; item is the row id',
  'drawer.row-menu': 'Context menu of a drawer row (continue in a new chat)',
  'drawer.row-menu-item': 'Fork the row into a new chat; item is current or a model id',

  'chat.message-copy': 'Copy an assistant response; item is the message id',
  'chat.message-feedback': 'Open response feedback choices; item is the message id',
  'chat.message-like': 'Toggle positive local feedback; item is the message id',
  'chat.message-dislike': 'Toggle negative local feedback; item is the message id',
  'chat.message-branch': 'Continue in a new chat through this response; item is the message id',
  'chat.background-group': 'Expand or collapse background work; item is the first task id',
  'chat.background-task': 'Expand task description and result; item is the task id',
  'chat.background-jump': 'Open background task details above the chat',
  'chat.background-close': 'Close the background task details popup',
  'chat.history': 'Chat history panel (present only while open)',
  'chat.show-earlier': 'Reveal or load an earlier page of messages in the current chat',
  'chat.history-search': 'Filter the chat history list',
  'chat.history-open': 'Open a thread from history; item is the thread id',
  'chat.history-archive': 'Archive a thread from history; item is the thread id',
  'chat.history-retry': 'Retry loading chat history',
  'chat.sign-in': 'Sign in with ChatGPT when the pane is signed out',

  'composer.input': 'Message textarea of the selected pane',
  'composer.new-chat': 'Start a new chat from the composer',
  'composer.project': 'Open the active project menu',
  'composer.project-new': 'Choose a folder as a new project',
  'composer.project-recent': 'Switch to a previously used project; item is its folder path',
  'composer.project-clear': 'Leave project mode and use the home workspace',
  'composer.tools': 'Open the available tools dialog',
  'composer.trace': 'Open the live turn trace dialog',
  'composer.model': 'Open the model and reasoning-effort menu',
  'composer.model-item': 'Choose a model; item is the model id',
  'composer.model-more': 'Toggle the model menu between the top models per provider and every model',
  'composer.effort-item': 'Choose a reasoning effort; item is the effort',
  'composer.context': 'Open the context inspector',
  'composer.usage-card': 'Context window and plan usage, shown while the context meter is hovered',
  'composer.upload': 'Attach files',
  'composer.attachment-remove': 'Remove a pending attachment; item is the attachment id',
  'composer.stop': 'Stop the running turn (present only while running)',
  'composer.send': 'Send the message (present only while idle)',

  'browser.tab': 'Select a browser tab; item is the tab id',
  'browser.tab-close': 'Close a browser tab; item is the tab id',
  'browser.tab-new': 'Open a new browser tab',
  'browser.back': 'Browser back',
  'browser.forward': 'Browser forward',
  'browser.reload': 'Browser reload',
  'browser.suggestion': 'Navigate to an address suggestion; item is its URL',
  'browser.suggestion-remove': 'Remove a saved browser history entry; item is its URL',
  'browser.address': 'Address bar',
  'browser.downloads': 'Show or hide the downloads shelf',

  'downloads.clear': 'Clear finished downloads',
  'downloads.hide': 'Hide the downloads shelf',
  'downloads.pause': 'Pause a download; item is the download id',
  'downloads.resume': 'Resume a download; item is the download id',
  'downloads.reveal': 'Show a download in its folder; item is the download id',
  'downloads.cancel': 'Cancel a download; item is the download id',

  'dialog.tools': 'Tools dialog root (present only while open)',
  'dialog.trace': 'Turn trace dialog root (present only while open)',
  'dialog.context': 'Context inspector dialog root (present only while open)',
  'dialog.settings': 'Appearance settings dialog root (present only while open)',
  'dialog.close': 'Close the open dialog',
  'tools.refresh': 'Refresh the tools list',
  'tools.clear': 'Clear tool usage counts',
  'tools.toggle': 'Turn a tool or action on or off; item is the tool id',
  'trace.refresh': 'Refresh the turn trace',
  'trace.clear': 'Clear the turn trace',
  'trace.filter': 'Toggle a trace filter; item is the entry kind or all-panes',
  'settings.reset': 'Reset appearance settings',
  'settings.decrease': 'Decrease an appearance value; item is chat-font-size, composer-font-size, or chat-zoom',
  'settings.range': 'Appearance slider; item is chat-font-size, composer-font-size, or chat-zoom',
  'settings.increase': 'Increase an appearance value; item is chat-font-size, composer-font-size, or chat-zoom'
} as const

export type UiControlId = keyof typeof UI_CONTROLS

export const UI_SURFACES = ['shell', 'side-drawer', 'chat', 'browser', 'browser-downloads', 'overlay'] as const

export type UiSurface = (typeof UI_SURFACES)[number]

/** Control families, for the tool description: the model learns the shape, not every id. */
export function uiControlFamilies(): string[] {
  return [...new Set(Object.keys(UI_CONTROLS).map((id) => id.slice(0, id.indexOf('.'))))]
}
