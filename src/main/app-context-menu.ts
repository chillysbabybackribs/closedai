import type {
  ContextMenuParams,
  MenuItemConstructorOptions,
  WebContents
} from 'electron'
import { linkContextMenuItems } from './link-context-menu.js'

type AppContextMenuState = Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'linkURL'> & {
  editFlags: Pick<
    ContextMenuParams['editFlags'],
    'canUndo' | 'canRedo' | 'canCut' | 'canCopy' | 'canPaste'
  >
}

export type AppContextMenuActions = {
  openLinkInNewTab: (url: string) => void
}

type NativeMenuFactory = {
  buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
    popup: () => void
  }
}

// The app shell is one renderer WebContents, so Chromium already knows whether the
// right-click landed in an editable control and which native edit roles are legal.
// Keep that decision in main: roles preserve controlled React inputs, keyboard
// selection, and clipboard MIME types without exposing a new preload/IPC surface.
export function appContextMenuTemplate(
  params: AppContextMenuState,
  actions: AppContextMenuActions
): MenuItemConstructorOptions[] {
  const linkItems = params.linkURL
    ? linkContextMenuItems(params.linkURL, { openInNewTab: actions.openLinkInNewTab })
    : []

  if (params.isEditable) {
    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ type: 'separator' as const }] : []),
      { label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo },
      { label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { label: 'Select all', role: 'selectAll' }
    ]
  }

  if (params.selectionText.trim()) {
    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ type: 'separator' as const }] : []),
      { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy }
    ]
  }

  return linkItems
}

export function installAppContextMenu(
  contents: WebContents,
  menu: NativeMenuFactory,
  actions: AppContextMenuActions
): void {
  contents.on('context-menu', (event, params) => {
    const template = appContextMenuTemplate(params, actions)
    if (template.length === 0) return
    event.preventDefault()
    menu.buildFromTemplate(template).popup()
  })
}
