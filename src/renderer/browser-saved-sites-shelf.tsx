import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import type { SavedSite } from '../shared/saved-sites.js'
import { BrowserSiteIcon } from './browser-site-icon.js'
import type { BrowserSavedSitesController } from './browser-saved-sites-controller.js'

// Floating panel anchored under the toolbar star, the same placement as the downloads popover.
// Each row is the record a daily brief will later read: the page, and an optional note saying
// why. The note is plain text until clicked, so a row without one stays quiet.

export function BrowserSavedSitesShelf({
  controller,
  onError
}: {
  controller: BrowserSavedSitesController
  onError: (reason: unknown) => void
}): JSX.Element {
  return (
    <section
      className="browser-saved-sites"
      aria-label="Saved sites"
      role="dialog"
      aria-modal="false"
      data-ui-surface="browser-saved-sites"
      data-ui-source="src/renderer/browser-saved-sites-shelf.tsx#BrowserSavedSitesShelf" data-ui-state-owner="src/renderer/browser-saved-sites-controller.ts#useBrowserSavedSitesController"
    >
      <header className="browser-saved-sites-head">
        <span className="browser-saved-sites-title">Saved sites{controller.sites.length ? ` · ${controller.sites.length}` : ''}</span>
        <button
          type="button"
          className="browser-saved-sites-close"
          aria-label="Hide saved sites"
          data-ui="saved-sites.hide"
          title="Hide saved sites"
          onClick={controller.dismiss}
        >
          <X size={12} />
        </button>
      </header>
      {controller.sites.length === 0 ? (
        <p className="browser-saved-sites-empty">Nothing saved yet. Press the star on a page to keep it here.</p>
      ) : (
        <ul className="browser-saved-sites-list">
          {controller.sites.map((site) => (
            <SavedSiteRow key={site.id} site={site} controller={controller} onError={onError} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SavedSiteRow({
  site,
  controller,
  onError
}: {
  site: SavedSite
  controller: BrowserSavedSitesController
  onError: (reason: unknown) => void
}): JSX.Element {
  const label = site.title || hostOf(site.url)
  return (
    <li className="browser-saved-sites-row">
      <button
        type="button"
        className="browser-saved-sites-open"
        data-ui="saved-sites.open"
        data-ui-key={site.id}
        title={site.url}
        aria-label={`Open ${label}`}
        onClick={() => { void controller.open(site.url).catch(onError) }}
      >
        <BrowserSiteIcon favicon={site.favicon ?? undefined} />
        <span className="browser-saved-sites-text">
          <span className="browser-saved-sites-name">{label}</span>
          <span className="browser-saved-sites-host">{hostOf(site.url)}</span>
        </span>
      </button>
      <button
        type="button"
        className="browser-saved-sites-remove"
        data-ui="saved-sites.remove"
        data-ui-key={site.id}
        aria-label={`Remove ${label} from saved sites`}
        title="Remove"
        onClick={() => { void controller.remove(site.id).catch(onError) }}
      >
        <Trash2 size={12} />
      </button>
      <SavedSiteNote site={site} label={label} controller={controller} onError={onError} />
    </li>
  )
}

function SavedSiteNote({
  site,
  label,
  controller,
  onError
}: {
  site: SavedSite
  label: string
  controller: BrowserSavedSitesController
  onError: (reason: unknown) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(site.note)
  // A remote change (another pane, a later brief agent) wins over a stale draft only while the
  // field is not open.
  useEffect(() => { if (!editing) setDraft(site.note) }, [site.note, editing])
  if (!editing) {
    return (
      <button
        type="button"
        className={`browser-saved-sites-note-text ${site.note ? '' : 'is-empty'}`}
        data-ui="saved-sites.note-edit"
        data-ui-key={site.id}
        aria-label={site.note ? `Edit note for ${label}` : `Add note for ${label}`}
        title={site.note ? 'Edit note' : 'Add a note'}
        onClick={() => { setDraft(site.note); setEditing(true) }}
      >
        {site.note || 'Add note'}
      </button>
    )
  }
  const close = (): void => setEditing(false)
  const commit = (): void => {
    const next = draft.trim()
    if (next !== site.note) void controller.update(site.id, next).catch(onError)
    close()
  }
  return (
    <input
      autoFocus
      className="browser-saved-sites-note"
      data-ui="saved-sites.note"
      data-ui-key={site.id}
      value={draft}
      placeholder="Why keep this? What to watch for…"
      aria-label={`Note for ${label}`}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit() }
        if (event.key === 'Escape') { event.preventDefault(); setDraft(site.note); close() }
      }}
    />
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}
