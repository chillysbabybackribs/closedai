import type { JSX } from 'react'
import { FolderOpen, Pause, Play, X } from 'lucide-react'
import type { BrowserDownload } from '../shared/types.js'
import type { BrowserDownloadsController } from './browser-downloads-controller.js'
import { downloadActions, downloadDetail, progressPercent } from './browser-downloads-model.js'

// Floating Downloads Dropdown Popover:
// Rendered as a floating popover anchored beneath the toolbar Downloads button.
// The native view overlay freeze automatically preserves the rendered page still
// behind this dropdown while it is open without causing chassis layout reflows.

export function BrowserDownloadsShelf({
  controller
}: {
  controller: BrowserDownloadsController
}): JSX.Element {
  return (
    <section
      className="browser-downloads browser-downloads-popover"
      aria-label="Downloads"
      role="dialog"
      aria-modal="false"
      data-ui-surface="browser-downloads"
      data-ui-source="src/renderer/browser-downloads-shelf.tsx#BrowserDownloadsShelf" data-ui-state-owner="src/renderer/browser-downloads-controller.ts#useBrowserDownloadsController"
    >
      <header className="browser-downloads-head">
        <span className="browser-downloads-title">Downloads</span>
        <div className="browser-downloads-head-actions">
          <button type="button" className="browser-downloads-link" data-ui="downloads.clear" onClick={controller.clear}>
            Clear finished
          </button>
          <button
            type="button"
            className="browser-downloads-close"
            aria-label="Hide downloads"
            data-ui="downloads.hide"
            title="Hide downloads"
            onClick={controller.dismiss}
          >
            <X size={12} />
          </button>
        </div>
      </header>
      {controller.downloads.length === 0 ? (
        <p className="browser-downloads-empty">Nothing downloaded yet.</p>
      ) : (
        <ul className="browser-downloads-list">
          {controller.downloads.map((download) => (
            <DownloadRow key={download.id} download={download} controller={controller} />
          ))}
        </ul>
      )}
    </section>
  )
}

function DownloadRow({
  download,
  controller
}: {
  download: BrowserDownload
  controller: BrowserDownloadsController
}): JSX.Element {
  const actions = downloadActions(download)
  const percent = progressPercent(download)
  return (
    <li className={`browser-downloads-row is-${download.state}`}>
      <div className="browser-downloads-row-text">
        <span className="browser-downloads-name" title={download.url}>{download.filename}</span>
        <span className="browser-downloads-detail">{downloadDetail(download)}</span>
      </div>
      {download.state === 'progressing' || download.state === 'paused' ? (
        <div
          className={`browser-downloads-bar ${percent === null ? 'is-indeterminate' : ''}`}
          role="progressbar"
          aria-label={`${download.filename} progress`}
          aria-valuenow={percent ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="browser-downloads-bar-fill" style={{ width: `${percent ?? 100}%` }} />
        </div>
      ) : null}
      <div className="browser-downloads-row-actions">
        {actions.canPause ? (
          <RowButton control="downloads.pause" id={download.id} label={`Pause ${download.filename}`} onClick={() => controller.pause(download.id)}>
            <Pause size={12} />
          </RowButton>
        ) : null}
        {actions.canResume ? (
          <RowButton control="downloads.resume" id={download.id} label={`Resume ${download.filename}`} onClick={() => controller.resume(download.id)}>
            <Play size={12} />
          </RowButton>
        ) : null}
        {actions.canReveal ? (
          <RowButton control="downloads.reveal" id={download.id} label={`Show ${download.filename} in folder`} onClick={() => controller.reveal(download.id)}>
            <FolderOpen size={12} />
          </RowButton>
        ) : null}
        {actions.canCancel ? (
          <RowButton control="downloads.cancel" id={download.id} label={`Cancel ${download.filename}`} onClick={() => controller.cancel(download.id)}>
            <X size={12} />
          </RowButton>
        ) : null}
      </div>
    </li>
  )
}

function RowButton({
  control,
  id,
  label,
  onClick,
  children
}: {
  control: string
  id: string
  label: string
  onClick: () => void
  children: JSX.Element
}): JSX.Element {
  return (
    <button type="button" className="browser-downloads-action" data-ui={control} data-ui-key={id} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  )
}
