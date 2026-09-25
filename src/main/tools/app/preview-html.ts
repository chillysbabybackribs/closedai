import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_WAIT_MS } from '../browser/fields.js'
import { requireBrowser, type BrowserHostProvider } from '../browser/host.js'
import { requireHost, type AppCommandHost, type AppUiHost } from './host.js'

const HTML_EXT = new Set(['.html', '.htm'])

export type WorkspaceFile = { path: string; fileUrl: string }

/** Resolve a workspace HTML mock to an absolute path and file URL, confined to cwd. */
export async function resolveHtmlPreview(
  input: string, cwd: string, wrongType = 'preview_html only opens .html or .htm files'
): Promise<WorkspaceFile> {
  return resolveWorkspaceFile(input, cwd, HTML_EXT, wrongType)
}

/** An existing file under cwd with one of `extensions` (lower-case, with the dot). */
export async function resolveWorkspaceFile(
  input: string, cwd: string, extensions: ReadonlySet<string>, wrongType: string
): Promise<WorkspaceFile> {
  const absolute = insideCwd(input, cwd)
  if (!extensions.has(path.extname(absolute).toLowerCase())) throw new Error(wrongType)
  const info = await stat(absolute).catch((error: NodeJS.ErrnoException) => {
    throw error.code === 'ENOENT' ? new Error(`No file at ${absolute}`) : error
  })
  if (!info.isFile()) throw new Error(`${absolute} is not a file`)
  await access(absolute)
  return { path: absolute, fileUrl: pathToFileURL(absolute).href }
}

/** Absolute path for `input` (relative to cwd or absolute inside it); the file need not exist. */
export function insideCwd(input: string, cwd: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('path is required')
  const root = path.resolve(cwd)
  const absolute = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed)
  const rel = path.relative(root, absolute)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path must stay inside the chat working directory (${root})`)
  }
  return absolute
}

/** The working directory of `paneId` (the caller's pane, else the selected one). */
export function chatCwd(host: AppCommandHost, callerPaneId: string | null | undefined): string {
  const paneId = callerPaneId ?? host.selectedPaneId()
  const chat = host.state(['chat'], paneId, callerPaneId ?? null).chat as { cwd?: string } | null
  if (!chat?.cwd) throw new Error('Could not read the chat working directory')
  return chat.cwd
}

export type PreviewHosts = {
  app: () => AppCommandHost | null
  ui: () => AppUiHost | null
  page: BrowserHostProvider
}

/** Open a workspace file in a new tab claimed by the caller, revealing the browser pane when asked. */
export async function openWorkspacePreview(
  file: WorkspaceFile, callerPaneId: string | null | undefined, hosts: PreviewHosts, reveal = true
): Promise<Record<string, unknown>> {
  const host = requireHost(hosts.app, 'app commands')
  // Opening a tab can show the pane on its own, so read visibility before navigating.
  const hiddenBefore = reveal && (await browserPaneVisible(hosts.ui)) === false
  const outcome = await requireBrowser(hosts.page).navigate(file.fileUrl, {
    newTab: true,
    ready: { until: 'load', timeoutMs: DEFAULT_WAIT_MS }
  })
  if (!outcome.ok) throw new Error(`Could not open ${file.path}: ${outcome.error}`)
  const browser = await host.browserTab({ op: 'claim', tabId: outcome.tabId }, callerPaneId)
  const browserRevealed = hiddenBefore ? await revealBrowserPane(hosts.ui) : false
  return {
    ...file,
    tabId: outcome.tabId,
    title: outcome.ready.title,
    url: outcome.ready.url,
    browser,
    browserRevealed
  }
}

/** null when the renderer automation host is unavailable. */
async function browserPaneVisible(uiProvider: () => AppUiHost | null): Promise<boolean | null> {
  const automation = uiProvider()
  if (!automation) return null
  return (await automation.uiState()).layout?.browserVisible === true
}

/** Call only when the pane was hidden before the preview tab opened; true means it is shown now. */
async function revealBrowserPane(uiProvider: () => AppUiHost | null): Promise<boolean> {
  const automation = uiProvider()
  if (!automation) return false
  if (await browserPaneVisible(uiProvider)) return true
  await automation.click({ control: 'composer.browser' })
  return true
}
