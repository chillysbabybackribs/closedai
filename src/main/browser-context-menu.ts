import { Menu, clipboard, type WebContents, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'
import { normalizeUrl } from './browser-url.js'
import { linkContextMenuItems } from './link-context-menu.js'

// Right-click menu for the live browser page. The page is a native WebContentsView, so the
// renderer never sees clicks on it — the context menu MUST be built in the main process from
// the 'context-menu' event and shown as a native Menu. Kept in its own module so browser-tab
// stays focused on lifecycle/CDP.
//
// The menu adapts to what was actually clicked (link, image, selected text, editable field),
// like a real browser, rather than showing one fixed list. Navigation actions are delegated
// back to the owning tab so back/forward/reload go through the same guarded paths as the toolbar.

export type ContextMenuActions = {
  back: () => void
  forward: () => void
  reload: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  // Open a URL (e.g. a link's href) in this tab.
  openUrl: (url: string) => void
  // Preserve the current page and open the URL in a background CodeApp tab.
  openUrlInNewTab: (url: string) => void
  // What a per-site cookie re-import would do here, or null when this page has no
  // importable domain (about:blank, an IP literal) or no source browser is installed.
  siteCookieImport: () => { domain: string; source: string } | null
  // Re-clone this site's cookies from that source browser, then reload.
  importSiteCookies: () => void
}

export function showBrowserContextMenu(
  wc: WebContents,
  params: ContextMenuParams,
  actions: ContextMenuActions
): void {
  const template: MenuItemConstructorOptions[] = []
  const editable = params.isEditable
  const hasSelection = params.selectionText.trim().length > 0

  // --- Link actions ---------------------------------------------------------
  if (params.linkURL) {
    template.push(
      ...linkContextMenuItems(params.linkURL, {
        openInCurrentTab: actions.openUrl,
        openInNewTab: actions.openUrlInNewTab,
        saveAs: (url) => wc.downloadURL(url),
        copyAddress: (url) => clipboard.writeText(url)
      }),
      { type: 'separator' }
    )
  }

  // --- Image actions --------------------------------------------------------
  if (params.hasImageContents && params.srcURL) {
    template.push(
      // Chromium renders a bare image URL in its own standalone viewer, so "open in new tab"
      // needs no special handling here — it is an ordinary navigation to the src.
      { label: 'Open image in new tab', click: () => actions.openUrlInNewTab(params.srcURL) },
      // downloadURL re-requests through the same session, so cookies and referer-gated CDNs
      // behave as they did for the page. It lands in the will-download pipeline like any
      // other download rather than opening an OS save dialog.
      { label: 'Save image as…', click: () => wc.downloadURL(params.srcURL) },
      { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) },
      { type: 'separator' }
    )
  }

  // --- Editable field: full clipboard + selection roles ---------------------
  if (editable) {
    template.push(
      { label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo },
      { label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
      { label: 'Select all', role: 'selectAll' }
    )
    // Offer to navigate to a selected string that looks like a URL/search.
    if (hasSelection) {
      template.push({ type: 'separator' }, searchOrGoItem(params.selectionText, actions))
    }
  } else if (hasSelection) {
    // --- Non-editable selection: copy + search/go ---------------------------
    template.push(
      { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
      searchOrGoItem(params.selectionText, actions),
      { type: 'separator' }
    )
  }

  // --- Always-available page navigation -------------------------------------
  template.push(
    { label: 'Back', enabled: actions.canGoBack(), click: () => actions.back() },
    { label: 'Forward', enabled: actions.canGoForward(), click: () => actions.forward() },
    { label: 'Reload', click: () => actions.reload() },
    { label: 'Copy page URL', click: () => clipboard.writeText(wc.getURL()) }
  )

  // --- Per-site session repair ----------------------------------------------
  // The startup cookie import runs once per profile, so any site the user signed into
  // afterwards shows up here logged out with no way back. Naming the source browser
  // keeps the action honest about where the session is coming from.
  const cookieImport = actions.siteCookieImport()
  if (cookieImport) {
    template.push({
      label: `Import ${cookieImport.domain} cookies from ${cookieImport.source}`,
      click: () => actions.importSiteCookies()
    })
  }

  template.push(
    { type: 'separator' },
    // Use Chromium's native element inspector so DevTools opens for this exact
    // WebContentsView and selects the node beneath the original right-click.
    { label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) }
  )

  Menu.buildFromTemplate(dedupeSeparators(template)).popup()
}

// "Go to <url>" for a selection that is a URL, otherwise "Search for <text>". normalizeUrl
// decides which (bare domains → https, free text → search), so this reuses the omnibox logic.
function searchOrGoItem(selection: string, actions: ContextMenuActions): MenuItemConstructorOptions {
  const text = selection.trim()
  const short = text.length > 32 ? `${text.slice(0, 32)}…` : text
  const looksLikeUrl = /^(?:https?:\/\/|[\w-]+(?:\.[\w-]+)+)/i.test(text)
  return {
    label: looksLikeUrl ? `Go to “${short}”` : `Search for “${short}”`,
    click: () => actions.openUrl(normalizeUrl(text))
  }
}

// Collapse leading/trailing/double separators so an empty section never leaves a stray line.
function dedupeSeparators(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = []
  for (const item of items) {
    if (item.type === 'separator') {
      if (out.length === 0 || out[out.length - 1].type === 'separator') continue
    }
    out.push(item)
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop()
  return out
}
